import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";

import { getOrCreateSession, saveSession } from "../lib/session";
import { getAuthURL, getToken } from "../lib/tesla";

const ALLOWED_USERS = (process.env.TESLA_ALLOWED_USERS || "").split(/[ ,;]+/).filter(Boolean);
const DOMAIN = process.env.TESLA_DOMAIN as string;

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const { setCookie, sid, session } = await getOrCreateSession(
      event.headers || {},
      DOMAIN,
      event.cookies,
    );

    if (!process.env.TESLA_CLIENT_ID || !process.env.TESLA_CLIENT_SECRET) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        cookies: [setCookie],
        body: JSON.stringify({
          title: "Container is running",
          message: "Up and running",
          error:
            "Need the Tesla client ID and secret to do anything useful, but make sure TLS works here first.",
        }),
      };
    }

    if (!session.user) {
      return {
        statusCode: 302,
        headers: { Location: getAuthURL(sid) },
        cookies: [setCookie],
        body: "",
      };
    }

    const username = session.user as string;
    if (!ALLOWED_USERS.includes(username)) {
      delete session.user;
      await saveSession(session);
      return {
        statusCode: 403,
        headers: { "Content-Type": "application/json" },
        cookies: [setCookie],
        body: JSON.stringify({
          message: "Unauthorized",
          error: `${username} not in ALLOWED_USERS`,
        }),
      };
    }

    try {
      const userToken = await getToken(username);
      if (userToken === "NO_TOKEN") {
        return {
          statusCode: 302,
          headers: { Location: getAuthURL(sid) },
          cookies: [setCookie],
          body: "",
        };
      }

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        cookies: [setCookie],
        body: JSON.stringify({
          CLIENT_ID: process.env.TESLA_CLIENT_ID,
          title: "Fleet API Tokens",
          user: username,
          access_token: userToken.access_token,
          refresh_token: userToken.refresh_token,
          expiration: userToken.expiration,
          showPrivateKey: username === ALLOWED_USERS[0],
          domain: DOMAIN,
        }),
      };
    } catch (e) {
      if (String(e).startsWith("401")) {
        return {
          statusCode: 302,
          headers: { Location: getAuthURL(sid) },
          cookies: [setCookie],
          body: "",
        };
      }
      return {
        statusCode: 503,
        headers: { "Content-Type": "application/json" },
        cookies: [setCookie],
        body: JSON.stringify({
          message: "Failed to refresh token",
          error: String(e),
        }),
      };
    }
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Internal error", error: String(err) }),
    };
  }
}
