import "dotenv/config";
import { ddbGet, ddbPut } from "./db";

const CLIENT_ID = process.env.TESLA_CLIENT_ID as string;
const CLIENT_SECRET = process.env.TESLA_CLIENT_SECRET as string;
const AUDIENCE =
  (process.env.TESLA_AUDIENCE as string) || "https://fleet-api.prd.na.vn.cloud.tesla.com";
const LOCALE = (process.env.TESLA_LOCALE as string) || "en-US";
const DOMAIN = process.env.TESLA_DOMAIN as string; // hostname only for partner registration
const SCOPE =
  (process.env.TESLA_SCOPE as string) ||
  "openid user_data vehicle_device_data vehicle_cmds vehicle_charging_cmds energy_device_data energy_cmds offline_access";

type Token = {
  access_token: string;
  refresh_token: string;
  expiration: number;
};

type TokenExchangeResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

type TokenRow = Token & { username: string };

export function getAuthURL(state: string) {
  const redirectUrl = `https://${DOMAIN}/tesla-callback`;
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    locale: LOCALE,
    prompt: "login",
    redirect_uri: redirectUrl,
    response_type: "code",
    scope: SCOPE,
    state,
  });
  return `https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/authorize?${params.toString()}`;
}

export async function doTokenExchange(code: string): Promise<Token> {
  const redirectUrl = `https://${DOMAIN}/tesla-callback`;
  const req = await fetch("https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      audience: AUDIENCE,
      redirect_uri: redirectUrl,
    }),
  });
  const json = (await req.json()) as TokenExchangeResponse;
  if (!req.ok) throw new Error(`${req.status}: ${JSON.stringify(json)}`);
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expiration: Math.floor(Date.now() / 1000) + json.expires_in,
  };
}

export async function doRefresh(refresh_token: string): Promise<Token> {
  const req = await fetch("https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token,
    }),
  });
  const json = (await req.json()) as TokenExchangeResponse;
  if (!req.ok) throw new Error(`${req.status}: ${JSON.stringify(json)}`);
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expiration: Math.floor(Date.now() / 1000) + json.expires_in,
  };
}

export async function getUsername(accessToken: string) {
  const req = await fetch(`${AUDIENCE}/api/1/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = (await req.json()) as { response: { email: string } };
  if (!req.ok) throw new Error(`${req.status}: ${JSON.stringify(json)}`);
  return json.response.email;
}

export async function doRegister() {
  const partnerTokenResp = await fetch(
    "https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope: SCOPE,
        audience: AUDIENCE,
      }),
    },
  );
  const partnerJson = (await partnerTokenResp.json()) as { access_token: string };
  if (!partnerTokenResp.ok)
    throw new Error(`${partnerTokenResp.status}: ${JSON.stringify(partnerJson)}`);
  const partnerToken = partnerJson.access_token;

  const req = await fetch(`${AUDIENCE}/api/1/partner_accounts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${partnerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ domain: DOMAIN }),
  });
  const json = await req.json();
  if (!req.ok) throw new Error(`${req.status}: ${JSON.stringify(json)}`);
}

export async function getTeslaSiteId(accessToken: string) {
  const req = await fetch(`${AUDIENCE}/api/1/products`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = (await req.json()) as { response: Array<{ energy_site_id?: string }> };
  if (!req.ok) throw new Error(`${req.status}: ${JSON.stringify(json)}`);
  const first = json.response[0];
  if (!first?.energy_site_id) throw new Error("No energy_site_id found in products response");
  return first.energy_site_id;
}

export async function adjustBackupReservePercent({
  accessToken,
  siteId,
  backupReservePercent,
}: {
  accessToken: string;
  siteId: string;
  backupReservePercent: number;
}) {
  const req = await fetch(`${AUDIENCE}/api/1/energy_sites/${siteId}/backup`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ backup_reserve_percent: backupReservePercent }),
  });
  const json = await req.json();
  if (!req.ok) throw new Error(`${req.status}: ${JSON.stringify(json)}`);
}

export async function getTeslaSiteInfo({
  accessToken,
  siteId,
}: {
  accessToken: string;
  siteId: string;
}) {
  const req = await fetch(`${AUDIENCE}/api/1/energy_sites/${siteId}/site_info`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await req.json();
  if (!req.ok) throw new Error(`${req.status}: ${JSON.stringify(json)}`);
  return json as {
    response: {
      id: string;
      site_name: string;
      backup_reserve_percent: number;
    };
  };
}

export async function getBatteryLiveStatus({
  accessToken,
  siteId,
}: {
  accessToken: string;
  siteId: string;
}) {
  const req = await fetch(`${AUDIENCE}/api/1/energy_sites/${siteId}/live_status`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await req.json();
  if (!req.ok) throw new Error(`${req.status}: ${JSON.stringify(json)}`);
  return json as {
    response: {
      solar_power: number;
      percentage_charged: number;
      battery_power: number;
      load_power: number;
      grid_status: string;
      grid_power: number;
      generator_power: number;
      island_status: string;
      storm_mode_active: boolean;
      timestamp: string;
    };
  };
}

export async function getToken(
  username: string,
): Promise<
  { access_token: string; refresh_token: string; username: string; expiration: number } | "NO_TOKEN"
> {
  const TOKENS_TABLE = process.env.TESLA_TOKENS_TABLE as string;

  let userToken = await ddbGet<TokenRow>(TOKENS_TABLE, { username });

  if (!userToken) {
    return "NO_TOKEN";
  }

  if (userToken.expiration < Date.now() / 1000 + 3600) {
    const newToken = await doRefresh(userToken.refresh_token);
    userToken = { username: userToken.username, ...newToken };
  }

  // save the access_token and refresh_token to the database
  await ddbPut(TOKENS_TABLE, {
    username,
    access_token: userToken.access_token,
    refresh_token: userToken.refresh_token,
    expiration: userToken.expiration,
  });
  return userToken;
}
