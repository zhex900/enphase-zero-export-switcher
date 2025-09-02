import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";

import { ddbPut } from "../lib/db";
import { getOrCreateSession, saveSession } from "../lib/session";
import { doTokenExchange, getUsername } from "../lib/tesla";

const ALLOWED_USERS = (process.env.ALLOWED_USERS || "").split(/[ ,;]+/).filter(Boolean);
const TOKENS_TABLE = process.env.TOKENS_TABLE as string;
const DOMAIN = process.env.DOMAIN as string;

type Session = { sid: string; user?: string };

type Token = {
  access_token: string;
  refresh_token: string;
  expiration: number;
};

type Query = { state?: string; code?: string };

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const { setCookie, sid, session } = await getOrCreateSession(
      event.headers || {},
      DOMAIN,
      event.cookies,
    );
    const qs = (event.queryStringParameters || {}) as Query;
    let error: unknown = null;
    if (sid === qs.state && qs.code) {
      try {
        const token = (await doTokenExchange(qs.code)) as Token;
        const username = await getUsername(token.access_token);
        if (ALLOWED_USERS.includes(username)) {
          await ddbPut(TOKENS_TABLE, { username, ...token });
          (session as Session).user = username;
          await saveSession(session);
          return {
            statusCode: 302,
            headers: { Location: "/" },
            cookies: [setCookie],
            body: "",
          };
        } else {
          error = `${username} not in ALLOWED_USERS`;
        }
      } catch (e) {
        error = String(e);
      }
    }
    return {
      statusCode: 403,
      headers: { "Content-Type": "application/json" },
      cookies: [setCookie],
      body: JSON.stringify({
        message: "Unauthorized",
        error: JSON.stringify(error),
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Internal error", error: String(err) }),
    };
  }
}
