import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import axios, { AxiosInstance } from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";

const DEFAULT_USER_AGENT = "insomnia/11.4.0";

async function loginAndGetToken(options: {
  email: string;
  password: string;
  userAgent?: string;
}): Promise<{ token: string; jar: CookieJar; client: AxiosInstance }> {
  const { email, password, userAgent = DEFAULT_USER_AGENT } = options;

  const jar = new CookieJar();
  const client = wrapper(
    axios.create({
      withCredentials: true,
      headers: {
        "User-Agent": userAgent,
      },
    }),
  );

  const loginUrl =
    "https://enlighten.enphaseenergy.com/login/login" +
    `?user%5Bemail%5D=${encodeURIComponent(email)}` +
    `&user%5Bpassword%5D=${encodeURIComponent(password)}`;

  const loginRes = await client.post(loginUrl, undefined, { jar });

  // Compose Cookie header for the domain and find the token cookie
  let cookieHeader = await jar.getCookieString("https://enlighten.enphaseenergy.com/");
  if (!cookieHeader.includes("enlighten_manager_token_production=")) {
    // Fallback: if the cookie jar didn't capture the cookie, try to read Set-Cookie from response and set it manually
    const setCookie = loginRes.headers["set-cookie"] as string[] | string | undefined;
    if (setCookie) {
      const cookieArray = Array.isArray(setCookie) ? setCookie : [setCookie];
      for (const c of cookieArray) {
        try {
          await jar.setCookie(c, "https://enlighten.enphaseenergy.com/");
        } catch {
          // ignore bad cookie formats in fallback
        }
      }
      cookieHeader = await jar.getCookieString("https://enlighten.enphaseenergy.com/");
    }
  }
  const cookies = cookieHeader.split(/;\s*/);

  const tokenCookie = cookies.find((c) => c.startsWith("enlighten_manager_token_production="));

  if (!tokenCookie) {
    throw new Error("No enlighten_manager_token_production cookie found!");
  }

  const tokenValue = tokenCookie.split(";")[0]?.split("=")[1];
  if (!tokenValue) {
    throw new Error("Unable to extract token value from cookie");
  }

  return { token: tokenValue, jar, client };
}

async function changeGridProfile(options: {
  token: string;
  jar: CookieJar;
  client: AxiosInstance;
  systemId: string | number;
  userAgent?: string;
  gridProfileId: string;
}) {
  const { token, gridProfileId, jar, client, systemId, userAgent = DEFAULT_USER_AGENT } = options;
  const url = `https://enlighten.enphaseenergy.com/service/activation_backend/api/gateway/v4/systems/${systemId}/envoys`;

  await client.put(
    url,
    [
      {
        grid_profile_id: gridProfileId,
        serial_num: process.env.ENPHASE_SERIAL_NUMBER ?? "",
        part_num: process.env.ENPHASE_PART_NUMBER ?? "",
        ensemble_envoy: true,
      },
    ],
    {
      jar,
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": userAgent,
      },
    },
  );
}

interface Device {
  envoyCombiner: {
    "Envoy-S-Metered-EU": string[];
  };
  envoyGridProfile: {
    selected_profile_id: string;
    requested_profile_id: string;
    selected_grid_profile_name: string;
  };
  microInverters: {
    IQ8AC: string[];
  };
  qRelays: {
    "Q Relay": string[];
  };
  ensembleEnvoy: boolean;
}
async function fetchCurrentGridProfile(options: {
  token: string;
  jar: CookieJar;
  client: AxiosInstance;
  systemId: string | number;
  userAgent?: string;
}) {
  const { token, jar, client, systemId, userAgent = DEFAULT_USER_AGENT } = options;
  const url = `https://enlighten.enphaseenergy.com/service/activation_backend/api/gateway/v4/systems/${systemId}/devices/list`;

  const res = await client.get(url, {
    jar,
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": userAgent,
    },
  });
  const data = res.data as [Device];
  return data[0].envoyGridProfile;
}

const ZERO_EXPORT = "zero-export" as const;
const NORMAL_EXPORT = "normal-export" as const;

type GridProfileState = {
  systemId: string;
  profileId: string;
  profileName?: string;
  updatedAt: string;
};

function createDynamoClient() {
  const ddb = new DynamoDBClient({});
  return DynamoDBDocumentClient.from(ddb);
}

async function getStoredGridProfile(options: { tableName: string; systemId: string }) {
  const { tableName, systemId } = options;
  const docClient = createDynamoClient();
  const res = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { systemId },
    }),
  );
  return (res.Item as GridProfileState | undefined) ?? undefined;
}

async function putStoredGridProfile(options: { tableName: string; state: GridProfileState }) {
  const { tableName, state } = options;
  const docClient = createDynamoClient();
  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: state,
    }),
  );
}

function getDesiredGridProfileId(target: typeof ZERO_EXPORT | typeof NORMAL_EXPORT): string {
  return target === ZERO_EXPORT
    ? (process.env.ENPHASE_GRID_PROFILE_NAME_ZERO_EXPORT_ID ?? "")
    : (process.env.ENPHASE_GRID_PROFILE_NAME_NORMAL_EXPORT_ID ?? "");
}

async function persistProfileState(
  tableName: string | undefined,
  state: GridProfileState,
): Promise<void> {
  if (!tableName) return;
  try {
    await putStoredGridProfile({ tableName, state });
    console.log("Stored grid profile state to DynamoDB");
  } catch (err) {
    console.warn("Failed to store grid profile state to DynamoDB", err);
  }
}

async function setEnphaseGridProfile({
  gridProfile,
}: {
  gridProfile: typeof ZERO_EXPORT | typeof NORMAL_EXPORT;
}) {
  console.log("Setting grid profile to:", gridProfile);
  const email = process.env.ENPHASE_EMAIL ?? "";
  const password = process.env.ENPHASE_PASSWORD ?? "";
  const systemId = process.env.ENPHASE_SYSTEM_ID ?? "";
  const tableName = process.env.ENPHASE_TABLE_NAME;

  if (!email || !password) {
    console.error("Please set ENPHASE_EMAIL and ENPHASE_PASSWORD environment variables.");
    process.exit(1);
  }
  const gridProfileId = getDesiredGridProfileId(gridProfile);

  // If a DynamoDB table is configured, prefer checking stored state first
  let stored: GridProfileState | undefined;
  if (tableName) {
    try {
      stored = await getStoredGridProfile({ tableName, systemId });
      console.log("Stored grid profile:", stored);
      if (stored && stored.profileId === gridProfileId) {
        console.log("Stored grid profile already matches desired target; skipping change");
        return;
      }
    } catch (err) {
      console.warn("Failed to read stored grid profile state; proceeding with API check", err);
    }
  }

  const { token, jar, client } = await loginAndGetToken({ email, password });

  // Always confirm current profile before attempting a change
  const current = await fetchCurrentGridProfile({ token, jar, client, systemId });
  console.log("Current grid profile:", current.selected_grid_profile_name);

  if (current.selected_profile_id === gridProfileId) {
    console.log("Grid profile is already set to the desired value");
    await persistProfileState(tableName, {
      systemId,
      profileId: gridProfileId,
      profileName: current.selected_grid_profile_name,
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  console.log("Applying desired grid profile via Enphase API");
  await changeGridProfile({
    token,
    jar,
    client,
    systemId,
    gridProfileId,
  });

  const result = await fetchCurrentGridProfile({ token, jar, client, systemId });
  console.log("Result:", result);

  // Persist new state to DynamoDB if configured
  await persistProfileState(tableName, {
    systemId,
    profileId: gridProfileId,
    profileName: result.selected_grid_profile_name,
    updatedAt: new Date().toISOString(),
  });
}

export { setEnphaseGridProfile, ZERO_EXPORT, NORMAL_EXPORT };
