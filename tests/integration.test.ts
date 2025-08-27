import { describe, it, expect, beforeEach } from "vitest";

import { NORMAL_EXPORT, ZERO_EXPORT } from "../src/enphase";
import { main } from "../src/index";
import {
  mockAmberCurrentPrices,
  mockEnphaseEndpoints,
  resetEnphaseChangeRequests,
  enphaseChangeRequests,
} from "../vitest.setup";

const SYSTEM_ID = "SYS123";

describe("integration: price decision triggers Enphase change", () => {
  beforeEach(() => {
    resetEnphaseChangeRequests();
    process.env.ENPHASE_EMAIL = "user@example.com";
    process.env.ENPHASE_PASSWORD = "pass";
    process.env.ENPHASE_SYSTEM_ID = SYSTEM_ID;
    process.env.ENPHASE_SERIAL_NUMBER = "serial";
    process.env.ENPHASE_PART_NUMBER = "part";
    process.env.ENPHASE_GRID_PROFILE_NAME_ZERO_EXPORT_ID = ZERO_EXPORT;
    process.env.ENPHASE_GRID_PROFILE_NAME_NORMAL_EXPORT_ID = NORMAL_EXPORT;
    process.env.AMBER_TOKEN = "token";
    process.env.AMBER_SITE_ID = "SITE1";
  });

  it("when export price positive -> sets ZERO_EXPORT", async () => {
    mockAmberCurrentPrices({ siteId: "SITE1", importCents: 10, exportCents: 1 });
    mockEnphaseEndpoints({ systemId: SYSTEM_ID, initialSelectedProfileId: NORMAL_EXPORT });

    await main();

    expect(enphaseChangeRequests.at(-1)?.grid_profile_id).toBe(ZERO_EXPORT);
  });

  it("when export price negative -> sets NORMAL_EXPORT", async () => {
    mockAmberCurrentPrices({ siteId: "SITE1", importCents: 10, exportCents: -5 });
    mockEnphaseEndpoints({ systemId: SYSTEM_ID, initialSelectedProfileId: ZERO_EXPORT });

    await main();

    expect(enphaseChangeRequests.at(-1)?.grid_profile_id).toBe(NORMAL_EXPORT);
  });

  it("no-op when requested equals current -> does not call change", async () => {
    mockAmberCurrentPrices({ siteId: "SITE1", importCents: 10, exportCents: 1 });
    mockEnphaseEndpoints({ systemId: SYSTEM_ID, initialSelectedProfileId: ZERO_EXPORT });

    await main();

    // Since already ZERO_EXPORT, there should be no change requests
    expect(enphaseChangeRequests.length).toBe(0);
  });
});
