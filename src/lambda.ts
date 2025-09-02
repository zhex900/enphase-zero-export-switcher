import { main } from "./index";

export const handler = async (event: any): Promise<void> => {
  const skipEnphase = !!(event && event.skipEnphase);
  await main({ skipEnphase });
};
