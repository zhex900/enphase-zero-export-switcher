import dotenv from "dotenv";

import { createAmber } from "./amber";
import { NORMAL_EXPORT, ZERO_EXPORT, setEnphaseGridProfile } from "./enphase";
import { tesla } from "./tesla";

dotenv.config();

export async function main(): Promise<void> {
  const amber = createAmber({
    apiToken: process.env.AMBER_TOKEN ?? "",
    siteId: process.env.AMBER_SITE_ID ?? "",
  });

  const { cost, prices } = await amber.costsMeToExport();

  const gridProfile = cost ? ZERO_EXPORT : NORMAL_EXPORT;

  await setEnphaseGridProfile({
    gridProfile,
  });
  await tesla({ gridProfile, importPrice: prices.import.centsPerKwh });
}

if (require.main === module) {
  main().then(() => {
    console.log("done");
  });
}
