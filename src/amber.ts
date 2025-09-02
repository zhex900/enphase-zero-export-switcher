import axios, { AxiosInstance } from "axios";

interface AmberPriceData {
  channelType: string;
  nemTime: string; // ISO8601 end time for the interval
  perKwh: number; // price in cents per kWh
}

export interface CurrentPrice {
  nemTimeEndAt: string;
  centsPerKwh: number;
}

export interface CurrentPrices {
  import: CurrentPrice;
  export: CurrentPrice;
}

type Logger = {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export interface AmberClient {
  currentPrices(resolution?: number): Promise<CurrentPrices>;
  costsMeToExport(): Promise<{
    cost: boolean;
    prices: CurrentPrices;
  }>;
}

export function createAmber(options: {
  apiToken: string;
  siteId: string;
  apiBaseUrl?: string;
  logger?: Logger;
}): AmberClient {
  const { apiToken, siteId, apiBaseUrl = "https://api.amber.com.au", logger } = options;

  const http: AxiosInstance = axios.create({
    baseURL: apiBaseUrl,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: "application/json",
    },
  });
  const log: Logger = logger ?? console;
  const siteIdentifier = siteId;

  async function currentPrices(resolution: number = 30): Promise<CurrentPrices> {
    try {
      const response = await http.get(`/v1/sites/${siteIdentifier}/prices/current`, {
        params: { resolution },
      });

      const pricesData: AmberPriceData[] = response.data;
      const priceDataByChannel = new Map<string, AmberPriceData>();

      pricesData.forEach((priceData) => {
        priceDataByChannel.set(priceData.channelType, priceData);
      });

      const importPriceData = priceDataByChannel.get("general");
      const exportPriceData = priceDataByChannel.get("feedIn");

      if (!importPriceData || !exportPriceData) {
        throw new Error("Missing required price data for import or export");
      }

      const importPrice: CurrentPrice = {
        nemTimeEndAt: importPriceData.nemTime,
        centsPerKwh: importPriceData.perKwh,
      };

      const exportPrice: CurrentPrice = {
        nemTimeEndAt: exportPriceData.nemTime,
        centsPerKwh: exportPriceData.perKwh,
      };

      return {
        import: importPrice,
        export: exportPrice,
      };
    } catch (error) {
      log.error(`Failed to fetch current prices: ${error}`);
      throw error;
    }
  }

  async function costsMeToExport(): Promise<{
    cost: boolean;
    prices: CurrentPrices;
  }> {
    try {
      const prices = await currentPrices();
      const cost = prices.export.centsPerKwh;

      log.info(
        `Amber says exporting energy to the grid would currently ${cost > 0 ? "cost" : "earn"} me: ${Math.abs(cost)} c/kWh`,
      );

      return { cost: cost > 0, prices };
    } catch (error) {
      log.error(`Failed to determine export cost: ${error}`);
      throw error;
    }
  }

  return {
    costsMeToExport,
    currentPrices,
  };
}

export function amberFromEnv(logger?: Logger): AmberClient {
  const apiToken = process.env.AMBER_API_TOKEN ?? "";
  const siteId = process.env.AMBER_SITE_ID ?? "";
  if (!apiToken || !siteId) {
    throw new Error("Please set AMBER_API_TOKEN and AMBER_SITE_ID environment variables.");
  }
  return createAmber({ apiToken, siteId, logger });
}
