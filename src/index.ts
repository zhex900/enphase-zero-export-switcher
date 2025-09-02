import {
  GetScheduleCommand,
  SchedulerClient,
  UpdateScheduleCommand,
} from "@aws-sdk/client-scheduler";
import dotenv from "dotenv";

import { createAmber } from "./amber";
import { NORMAL_EXPORT, ZERO_EXPORT, setEnphaseGridProfile } from "./enphase";
import { tesla } from "./tesla";

dotenv.config();

export async function main({ skipEnphase } = { skipEnphase: false }): Promise<void> {
  const amber = createAmber({
    apiToken: process.env.AMBER_TOKEN ?? "",
    siteId: process.env.AMBER_SITE_ID ?? "",
  });

  const { cost, prices } = await amber.costsMeToExport();

  const gridProfile = cost ? ZERO_EXPORT : NORMAL_EXPORT;

  if (!skipEnphase) {
    await setEnphaseGridProfile({
      gridProfile,
    });
  }
  await toggleSchedule(gridProfile === ZERO_EXPORT ? "ENABLED" : "DISABLED");

  await tesla({ gridProfile, importPrice: prices.import.centsPerKwh });
}

if (require.main === module) {
  main().then(() => {
    console.log("done");
  });
}

async function getScheduler(): Promise<{ client: SchedulerClient; name: string }> {
  const arn = process.env.TESLA_SCHEDULER_ARN;
  if (!arn) throw new Error("TESLA_SCHEDULER_ARN not set");
  const name = arn.split(":").pop()!.split("/").pop()!;
  const client = new SchedulerClient({
    region: process.env.AWS_REGION,
  });
  return { client, name };
}

async function toggleSchedule(state: "ENABLED" | "DISABLED") {
  const { client, name } = await getScheduler();
  // 1. Fetch existing schedule
  const existing = await client.send(new GetScheduleCommand({ Name: name }));

  // if schedule is already in the desired state, skip
  if (existing.State === state) {
    console.log(`✅ Schedule "${name}" is already ${state}`);
    return;
  }

  // 2. Update with full config but modified state
  const cmd = new UpdateScheduleCommand({
    Name: name,
    ScheduleExpression: existing.ScheduleExpression!,
    FlexibleTimeWindow: existing.FlexibleTimeWindow!, // required
    Target: existing.Target!, // required
    State: state,
    Description: existing.Description,
    StartDate: existing.StartDate,
    EndDate: existing.EndDate,
    GroupName: existing.GroupName,
    KmsKeyArn: existing.KmsKeyArn,
    ScheduleExpressionTimezone: existing.ScheduleExpressionTimezone,
  });

  await client.send(cmd);
  console.log(`✅ Schedule "${name}" is now ${state}`);
}
