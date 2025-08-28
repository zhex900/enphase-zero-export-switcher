import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { beforeAll, afterEach, afterAll, vi } from "vitest";

// --- DynamoDB (AWS SDK v3) mock utilities ---
type AnyObject = Record<string, any>;
const ddbTables = new Map<string, Map<string, AnyObject>>();

function getTable(name: string): Map<string, AnyObject> {
  let table = ddbTables.get(name);
  if (!table) {
    table = new Map<string, AnyObject>();
    ddbTables.set(name, table);
  }
  return table;
}

export function resetDynamoMock() {
  ddbTables.clear();
}

export function seedDynamoItem(opts: { tableName: string; item: AnyObject }) {
  const table = getTable(opts.tableName);
  table.set(String(opts.item.systemId), opts.item);
}

export function getDynamoItem(opts: { tableName: string; systemId: string }) {
  const table = getTable(opts.tableName);
  return table.get(String(opts.systemId));
}

vi.mock("@aws-sdk/client-dynamodb", () => {
  class DynamoDBClient {
    // no-op client
    constructor() {}
  }
  return { DynamoDBClient };
});

vi.mock("@aws-sdk/lib-dynamodb", () => {
  class GetCommand {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  }
  class PutCommand {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  }
  class DynamoDBDocumentClient {
    static from() {
      return new DynamoDBDocumentClient();
    }
    async send(command: any) {
      if (command instanceof GetCommand) {
        const table = getTable(command.input.TableName);
        const key = String(command.input.Key.systemId);
        const Item = table.get(key);
        return { Item };
      }
      if (command instanceof PutCommand) {
        const table = getTable(command.input.TableName);
        const item = command.input.Item as AnyObject;
        const key = String(item.systemId);
        table.set(key, item);
        return {};
      }
      throw new Error("Unsupported command type in DynamoDB mock");
    }
  }
  return { DynamoDBDocumentClient, GetCommand, PutCommand };
});

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
