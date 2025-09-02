import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { beforeAll, afterEach, afterAll } from "vitest";

process.env.AWS_REGION = "ap-southeast-2";
process.env.TESLA_SCHEDULER_ARN =
  "arn:aws:scheduler:ap-southeast-2:123456789012:schedule/default/everyMinuteTeslaOnly";

// In CI, prevent AWS SDK from calling the instance metadata service and provide dummy creds
if (process.env.CI) {
  process.env.AWS_EC2_METADATA_DISABLED = "true";
  process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || "test";
  process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || "test";
  process.env.AWS_SESSION_TOKEN = process.env.AWS_SESSION_TOKEN || "test";
}

// --- DynamoDB (AWS SDK v3) mock utilities ---
type Primitive = string | number | boolean;
type PlainItem = Record<string, Primitive>;
type AttributeValue = { S: string } | { N: string } | { BOOL: boolean };
type DynamoItem = Record<string, AttributeValue>;

const ddbTables = new Map<string, Map<string, PlainItem>>();

function getTable(name: string): Map<string, PlainItem> {
  let table = ddbTables.get(name);
  if (!table) {
    table = new Map<string, PlainItem>();
    ddbTables.set(name, table);
  }
  return table;
}

export function resetDynamoMock() {
  ddbTables.clear();
}

export function seedDynamoItem(opts: { tableName: string; item: PlainItem }) {
  const table = getTable(opts.tableName);
  table.set(String(opts.item.systemId), opts.item);
}

export function getDynamoItem(opts: {
  tableName: string;
  systemId: string;
}): PlainItem | undefined {
  const table = getTable(opts.tableName);
  return table.get(String(opts.systemId));
}

// --- MSW handlers for DynamoDB (AWS SDK v3) ---
function unmarshallAttr(attr: AttributeValue | undefined): Primitive | undefined {
  if (!attr || typeof attr !== "object") return undefined;
  if ("S" in attr) return (attr as { S: string }).S;
  if ("N" in attr) return Number((attr as { N: string }).N);
  if ("BOOL" in attr) return Boolean((attr as { BOOL: boolean }).BOOL);
  return undefined;
}

function unmarshallItem(item: DynamoItem | undefined): PlainItem {
  const out: PlainItem = {};
  for (const [k, v] of Object.entries(item ?? {})) {
    const value = unmarshallAttr(v as AttributeValue);
    if (value !== undefined) out[k] = value;
  }
  return out;
}

function marshallValue(value: Primitive): AttributeValue {
  if (typeof value === "string") return { S: value };
  if (typeof value === "number") return { N: String(value) };
  if (typeof value === "boolean") return { BOOL: value };
  // Fallback shouldn't happen because Primitive covers all branches
  return { S: String(value) };
}

function marshallItem(item: PlainItem): DynamoItem {
  const out: DynamoItem = {};
  for (const [k, v] of Object.entries(item ?? {})) {
    out[k] = marshallValue(v as Primitive);
  }
  return out;
}

const dynamoHandler = http.post(
  /https?:\/\/dynamodb\.[-a-z0-9]+\.amazonaws\.com\/?/,
  async ({ request }) => {
    const target = request.headers.get("x-amz-target") || "";
    const body = (await request.json()) as {
      TableName?: string;
      Key?: DynamoItem;
      Item?: DynamoItem;
    };

    if (target.endsWith("GetItem")) {
      const table = getTable(String(body.TableName ?? ""));
      const key = unmarshallItem(body.Key);
      const item = table.get(String(key.systemId));
      return HttpResponse.json({ Item: item ? marshallItem(item) : undefined });
    }

    if (target.endsWith("PutItem")) {
      const table = getTable(String(body.TableName ?? ""));
      const item = unmarshallItem(body.Item);
      table.set(String(item.systemId), item);
      return HttpResponse.json({});
    }

    return HttpResponse.json({ message: "Unhandled DynamoDB operation" }, { status: 400 });
  },
);

// --- AWS EventBridge Scheduler (Get/Update schedule) ---
const schedulerHostRe = /https?:\/\/scheduler\.[-a-z0-9]+\.amazonaws\.com/;
const teslaSchedulePath = /\/schedules\/everyMinuteTeslaOnly/;
const schedulerHandlers = [
  // GetSchedule (optional query params)
  http.get(new RegExp(`${schedulerHostRe.source}${teslaSchedulePath.source}(?:\\?.*)?$`), () =>
    HttpResponse.json({
      Name: "everyMinuteTeslaOnly",
      GroupName: "default",
      ScheduleExpression: "rate(1 minute)",
      ScheduleExpressionTimezone: "UTC",
      State: "DISABLED",
      FlexibleTimeWindow: { Mode: "OFF" },
      Target: {
        Arn: "arn:aws:lambda:ap-southeast-2:123456789012:function:dummy",
        RoleArn: "arn:aws:iam::123456789012:role/dummy",
        Input: JSON.stringify({ skipEnphase: true }),
      },
    }),
  ),
  // UpdateSchedule (PUT)
  http.put(new RegExp(`${schedulerHostRe.source}${teslaSchedulePath.source}(?:\\?.*)?$`), () =>
    HttpResponse.json({}),
  ),
];

export const server = setupServer(dynamoHandler, ...schedulerHandlers);

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
          "Set-Cookie":
            "enlighten_manager_token_production=dummy; Path=/; Domain=enlighten.enphaseenergy.com; HttpOnly",
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
