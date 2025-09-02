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
  const siteId = await getTeslaSiteId(token.access_token);

  const {
    response: { backup_reserve_percent },
  } = await getTeslaSiteInfo({ accessToken: token.access_token, siteId });

  // on a cloudy day, when solar is not generating much, 
  // we want to set the backup reserve percent to normal to prevent grid charging.
  // if backup_reserve_percent === BACKUP_RESERVE_PERCENT_ZERO_EXPORT, and import grid is a lot 
  // set to BACKUP_RESERVE_PERCENT_NORMAL_EXPORT
  const desiredReserve =
    gridProfile === ZERO_EXPORT
      ? importPrice <= MINIMUM_IMPORT_PRICE
        ? BACKUP_RESERVE_PERCENT_ZERO_EXPORT
        : BACKUP_RESERVE_PERCENT_NORMAL_EXPORT
      : BACKUP_RESERVE_PERCENT_NORMAL_EXPORT;

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
