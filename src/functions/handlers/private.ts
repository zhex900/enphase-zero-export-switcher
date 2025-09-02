import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";

import { ddbGet } from "../lib/db";
import { getOrCreateSession } from "../lib/session";

const ALLOWED_USERS = (process.env.TESLA_ALLOWED_USERS || "").split(/[ ,;]+/).filter(Boolean);
const KEYS_TABLE = process.env.TESLA_KEYS_TABLE as string;
const DOMAIN = process.env.TESLA_DOMAIN as string;

type Session = { sid: string; user?: string };
type PrivateKeyRow = { id: string; value: string };

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { setCookie, session } = await getOrCreateSession(
    event.headers || {},
    DOMAIN,
    event.cookies,
  );
  const user = (session as Session).user;

  if (user && ALLOWED_USERS[0] === user) {
    const priv = (await ddbGet(KEYS_TABLE, { id: "private" })) as PrivateKeyRow | null;
    if (!priv) return { statusCode: 404, cookies: [setCookie], body: "Not Found" };
    return {
      statusCode: 200,
      headers: { "content-type": "application/x-pem-file" },
      cookies: [setCookie],
      body: priv.value,
    };
  } else if (user) {
    return {
      statusCode: 403,
      headers: { "Content-Type": "application/json" },
      cookies: [setCookie],
      body: JSON.stringify({
        message: "Unauthorized",
        error: `${user} not allowed to download private key.`,
      }),
    };
  } else {
    return {
      statusCode: 302,
      headers: { Location: "/" },
      cookies: [setCookie],
      body: "",
    };
  }
}
