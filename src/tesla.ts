import { NORMAL_EXPORT, ZERO_EXPORT } from "./enphase";
import {
  adjustBackupReservePercent,
  getBatteryLiveStatus,
  getTeslaSiteId,
  getTeslaSiteInfo,
  getToken,
} from "./functions/lib/tesla";

const BACKUP_RESERVE_PERCENT_ZERO_EXPORT = 100;
const BACKUP_RESERVE_PERCENT_NORMAL_EXPORT = 20;
const MINIMUM_IMPORT_PRICE = 15; // cents per kWh

export const tesla = async ({
  gridProfile,
  importPrice,
}: {
  gridProfile: typeof ZERO_EXPORT | typeof NORMAL_EXPORT;
  importPrice: number;
}) => {
  const token = await getToken(process.env.ENPHASE_EMAIL as string);
  if (token === "NO_TOKEN") {
    console.warn("Tesla: no token found; skipping Tesla adjustments");
    return;
  }
  //   console.log(token);
  const siteId = await getTeslaSiteId(token.access_token);

  const {
    response: { backup_reserve_percent },
  } = await getTeslaSiteInfo({ accessToken: token.access_token, siteId });
  // const {
  //   response: {
  //     //  percentage_charged,
  //     grid_power,
  //     solar_power,
  //     load_power,
  //   },
  // } = await getBatteryLiveStatus({ accessToken: token.access_token, siteId });
  let desiredReserve;

  if (gridProfile === ZERO_EXPORT) {
    desiredReserve = BACKUP_RESERVE_PERCENT_ZERO_EXPORT;
  } else {
    desiredReserve = BACKUP_RESERVE_PERCENT_NORMAL_EXPORT;
  }

  if (backup_reserve_percent !== desiredReserve) {
    console.log(`Setting backup reserve percent to ${desiredReserve}%`);
    await adjustBackupReservePercent({
      accessToken: token.access_token,
      siteId,
      backupReservePercent: desiredReserve,
    });
  }

  const siteInfo = await getTeslaSiteInfo({ accessToken: token.access_token, siteId });
  const liveStatus = await getBatteryLiveStatus({ accessToken: token.access_token, siteId });
  console.log(`Backup reserve percent: ${siteInfo.response.backup_reserve_percent}%`);
  console.log(liveStatus.response);
};
