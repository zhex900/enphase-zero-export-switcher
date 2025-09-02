import { main } from "./index";

export const handler = async (event: { skipEnphase: boolean }): Promise<void> => {
  const skipEnphase = !!(event && event.skipEnphase);
  await main({ skipEnphase });
};
