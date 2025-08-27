import axios, { AxiosInstance } from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";

async function loginAndGetToken(options: {
  email: string;
  password: string;
  userAgent?: string;
}): Promise<{ token: string; jar: CookieJar; client: AxiosInstance }> {
  const { email, password, userAgent = "insomnia/11.4.0" } = options;

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
    const setCookie = (loginRes.headers as any)["set-cookie"] as string[] | string | undefined;
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
  const { token, gridProfileId, jar, client, systemId, userAgent = "insomnia/11.4.0" } = options;
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
  const { token, jar, client, systemId, userAgent = "insomnia/11.4.0" } = options;
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

async function setEnphaseGridProfile({
  gridProfile,
}: {
  gridProfile: typeof ZERO_EXPORT | typeof NORMAL_EXPORT;
}) {
  console.log("Setting grid profile to:", gridProfile);
  const email = process.env.ENPHASE_EMAIL ?? "";
  const password = process.env.ENPHASE_PASSWORD ?? "";
  const systemId = process.env.ENPHASE_SYSTEM_ID ?? "";

  if (!email || !password) {
    console.error("Please set ENPHASE_EMAIL and ENPHASE_PASSWORD environment variables.");
    process.exit(1);
  }
  const { token, jar, client } = await loginAndGetToken({ email, password });

  const { selected_profile_id, selected_grid_profile_name } = await fetchCurrentGridProfile({
    token,
    jar,
    client,
    systemId,
  });

  console.log("Current grid profile:", selected_grid_profile_name);

  const gridProfileId =
    gridProfile === ZERO_EXPORT
      ? (process.env.ENPHASE_GRID_PROFILE_NAME_ZERO_EXPORT_ID ?? "")
      : (process.env.ENPHASE_GRID_PROFILE_NAME_NORMAL_EXPORT_ID ?? "");

  if (selected_profile_id === gridProfileId) {
    console.log("Grid profile is already set to the desired value");
    return;
  }

  console.log("Setting grid profile to the desired value");

  await changeGridProfile({
    token,
    jar,
    client,
    systemId,
    gridProfileId,
  });
  const result = await fetchCurrentGridProfile({
    token,
    jar,
    client,
    systemId,
  });

  console.log("Result:", result);
}

export { setEnphaseGridProfile, ZERO_EXPORT, NORMAL_EXPORT };
