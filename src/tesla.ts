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
  const {
    response: {
      //  percentage_charged,
      grid_power,
      solar_power,
      load_power,
    },
  } = await getBatteryLiveStatus({ accessToken: token.access_token, siteId });
  let desiredReserve;
  if (gridProfile === ZERO_EXPORT) {
    // if (
    //   percentage_charged === 100 &&
    //   backup_reserve_percent === BACKUP_RESERVE_PERCENT_ZERO_EXPORT
    // ) {
    //   desiredReserve = BACKUP_RESERVE_PERCENT_NORMAL_EXPORT;
    // } else {
    // ONLY in gridProfile === ZERO_EXPORT
    // AND it is importing from the grid
    // on a cloudy day, when solar is not generating much,
    // we want to set the backup reserve percent to normal to prevent grid charging.
    // if backup_reserve_percent === BACKUP_RESERVE_PERCENT_ZERO_EXPORT, and import grid is a lot
    // solar is generating less than house consumption, grid import is more than 1kW,
    // we want to set the backup reserve percent to normal to prevent grid charging.

    if (
      grid_power > 200 && // importing from grid
      solar_power < load_power && // solar is generating less than house consumption
      backup_reserve_percent === BACKUP_RESERVE_PERCENT_ZERO_EXPORT // current backup reserve is at max
    ) {
      console.log(
        `Importing from grid and solar is generating less than house consumption; setting to ${BACKUP_RESERVE_PERCENT_NORMAL_EXPORT}%`,
      );
      desiredReserve = BACKUP_RESERVE_PERCENT_NORMAL_EXPORT;
    } else {
      desiredReserve =
        importPrice <= MINIMUM_IMPORT_PRICE
          ? BACKUP_RESERVE_PERCENT_ZERO_EXPORT
          : BACKUP_RESERVE_PERCENT_NORMAL_EXPORT;
    }
    // // do not adjust backup to higher if current reserve is lower than desired reserve and
    // // battery level is below desiredReserve
    // // this means user manually set the backup reserve percent to a lower value
    // // only change to higher if the charge level is above desiredReserve
    // if (backup_reserve_percent < BACKUP_RESERVE_PERCENT_NORMAL_EXPORT) {
    //   console.log(
    //     `Current backup reserve ${backup_reserve_percent}% below normal reserve ${BACKUP_RESERVE_PERCENT_NORMAL_EXPORT}%; battery level is ${Math.round(percentage_charged)}%; skipping`,
    //   );
    //   return;
    // }
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
