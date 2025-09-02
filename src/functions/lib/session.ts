import crypto from "crypto";

import { ddbGet, ddbPut } from "./db";

import type { NativeAttributeValue } from "@aws-sdk/lib-dynamodb";

const SESSIONS_TABLE = process.env.SESSIONS_TABLE as string;
const ONE_WEEK_MS = 1000 * 60 * 60 * 24 * 7;

export function parseCookies(headers: Record<string, string | undefined>, cookiesArray?: string[]) {
  let cookieHeader = headers.cookie || headers.Cookie || "";
  if ((!cookieHeader || cookieHeader.length === 0) && Array.isArray(cookiesArray)) {
    cookieHeader = cookiesArray.join("; ");
  }
  const parts = (cookieHeader || "").split(/;\s*/).filter(Boolean);
  const map: Record<string, string> = {};
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx > -1) map[p.slice(0, idx)] = decodeURIComponent(p.slice(idx + 1));
  }
  return map;
}

export function createCookie(name: string, value: string, domainOrUrl?: string) {
  let domain: string | undefined = undefined;
  try {
    if (domainOrUrl && domainOrUrl.startsWith("http")) {
      const u = new URL(domainOrUrl);
      domain = u.hostname;
    } else {
      domain = domainOrUrl;
    }
  } catch (e) {
    console.error(e);
  }
  const attrs: string[] = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Secure`,
    `Max-Age=${Math.floor(ONE_WEEK_MS / 1000)}`,
  ];
  if (domain) attrs.push(`Domain=${domain}`);
  return attrs.join("; ");
}

type Session = { sid: string; user?: string };
type SessionRow = Session & { ttl?: number };

export async function getOrCreateSession(
  headers: Record<string, string | undefined>,
  domain?: string,
  cookiesArray?: string[],
) {
  const cookies = parseCookies(headers || {}, cookiesArray);
  let sid = cookies.sid;
  if (!sid) sid = crypto.randomBytes(16).toString("hex");

  let session = await ddbGet<SessionRow>(SESSIONS_TABLE, { sid });
  if (!session) session = { sid };

  const ttl = Math.floor((Date.now() + ONE_WEEK_MS) / 1000);
  const item: Record<string, NativeAttributeValue> = { ...session, ttl };
  await ddbPut(SESSIONS_TABLE, item);

  const setCookie = createCookie("sid", sid, domain);
  return { sid, session, setCookie };
}

export async function saveSession(session: Session) {
  const ttl = Math.floor((Date.now() + ONE_WEEK_MS) / 1000);
  const item: Record<string, NativeAttributeValue> = { ...session, ttl };
  await ddbPut(SESSIONS_TABLE, item);
}
