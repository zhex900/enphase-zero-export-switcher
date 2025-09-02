import { describe, it, expect } from "vitest";

import { createAmber } from "../src/amber";
import { mockAmberCurrentPrices } from "../vitest.setup";

describe("Amber client", () => {
  it("fetches current prices and maps import/export", async () => {
    mockAmberCurrentPrices({ siteId: "SITE1", importCents: 12.3, exportCents: -7.8 });
    const amber = createAmber({ apiToken: "dummy", siteId: "SITE1" });
    const prices = await amber.currentPrices(30);
    expect(prices.import.centsPerKwh).toBe(12.3);
    expect(prices.export.centsPerKwh).toBe(-7.8);
  });

  it("costsMeToExport returns true when export price is positive", async () => {
    mockAmberCurrentPrices({ siteId: "SITE1", importCents: 10, exportCents: 1 });
    const amber = createAmber({ apiToken: "dummy", siteId: "SITE1" });
    const { cost } = await amber.costsMeToExport();
    expect(cost).toBe(true);
  });

  it("costsMeToExport returns false when export price is negative or zero", async () => {
    mockAmberCurrentPrices({ siteId: "SITE1", importCents: 10, exportCents: 0 });
    const amberZero = createAmber({ apiToken: "dummy", siteId: "SITE1" });
    const { cost: costZero } = await amberZero.costsMeToExport();
    expect(costZero).toBe(false);

    mockAmberCurrentPrices({ siteId: "SITE1", importCents: 10, exportCents: -5 });
    const amberNeg = createAmber({ apiToken: "dummy", siteId: "SITE1" });
    const { cost: costNeg } = await amberNeg.costsMeToExport();
    expect(costNeg).toBe(false);
  });
});
