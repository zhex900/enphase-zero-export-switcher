import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { beforeAll, afterEach, afterAll } from "vitest";

export const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

export function mockAmberCurrentPrices(opts: {
  baseUrl?: string;
  siteId: string;
  resolution?: number;
  importCents: number;
  exportCents: number;
}) {
  const {
    baseUrl = "https://api.amber.com.au",
    siteId,
    resolution = 30,
    importCents,
    exportCents,
  } = opts;

  server.use(
    http.get(`${baseUrl}/v1/sites/${siteId}/prices/current`, ({ request }) => {
      const url = new URL(request.url);
      if (url.searchParams.get("resolution") !== String(resolution)) {
        return HttpResponse.json([], { status: 400 });
      }
      return HttpResponse.json([
        { channelType: "general", nemTime: new Date().toISOString(), perKwh: importCents },
        { channelType: "feedIn", nemTime: new Date().toISOString(), perKwh: exportCents },
      ]);
    }),
  );
}

export type EnphaseMockOptions = {
  systemId: string;
  initialSelectedProfileId: string;
};

export const enphaseChangeRequests: Array<{ grid_profile_id: string }> = [];

export function mockEnphaseEndpoints(opts: EnphaseMockOptions) {
  let currentSelectedProfileId = opts.initialSelectedProfileId;

  server.use(
    http.post("https://enlighten.enphaseenergy.com/login/login", () => {
      return new HttpResponse(null, {
        status: 200,
        headers: {
          // Use proper Set-Cookie header so axios-cookiejar-support stores it in the jar
          "Set-Cookie": [
            "enlighten_manager_token_production=dummy; Path=/; Domain=enlighten.enphaseenergy.com; HttpOnly",
          ],
        },
      });
    }),
  );

  server.use(
    http.get(
      `https://enlighten.enphaseenergy.com/service/activation_backend/api/gateway/v4/systems/${opts.systemId}/devices/list`,
      () => {
        const devices = [
          {
            envoyCombiner: { "Envoy-S-Metered-EU": [] },
            envoyGridProfile: {
              selected_profile_id: currentSelectedProfileId,
              requested_profile_id: currentSelectedProfileId,
              selected_grid_profile_name: "Mock Profile",
            },
            microInverters: { IQ8AC: [] },
            qRelays: { "Q Relay": [] },
            ensembleEnvoy: true,
          },
        ];
        return HttpResponse.json(devices);
      },
    ),
  );

  server.use(
    http.put(
      `https://enlighten.enphaseenergy.com/service/activation_backend/api/gateway/v4/systems/${opts.systemId}/envoys`,
      async ({ request }) => {
        const body = (await request.json()) as Array<{ grid_profile_id: string }>;
        const next = body?.[0]?.grid_profile_id;
        if (next) {
          enphaseChangeRequests.push({ grid_profile_id: next });
          currentSelectedProfileId = next;
        }
        return HttpResponse.json({ ok: true });
      },
    ),
  );
}

export function resetEnphaseChangeRequests() {
  enphaseChangeRequests.length = 0;
}
