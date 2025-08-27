import dotenv from "dotenv";

import { createAmber } from "./amber";
import { NORMAL_EXPORT, ZERO_EXPORT, setEnphaseGridProfile } from "./enphase";

dotenv.config();

export async function main(): Promise<void> {
  const amber = createAmber({
    apiToken: process.env.AMBER_TOKEN ?? "",
    siteId: process.env.AMBER_SITE_ID ?? "",
  });

  const costsMeToExport = await amber.costsMeToExport();

  await setEnphaseGridProfile({
    gridProfile: costsMeToExport ? ZERO_EXPORT : NORMAL_EXPORT,
  });
}

if (require.main === module) {
  main().then(() => {
    console.log("done");
  });
}
