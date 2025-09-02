import { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import crypto from "crypto";

import { ddbGet, ddbPut } from "../lib/db";

const KEYS_TABLE = process.env.TESLA_KEYS_TABLE as string;

type KeyId = "public" | "private";
type KeyRow = { id: KeyId; value: string };

async function readOrGenerateKeypair(wantPublic: boolean): Promise<string> {
  let pub = (await ddbGet(KEYS_TABLE, { id: "public" })) as KeyRow | null;
  let priv = (await ddbGet(KEYS_TABLE, { id: "private" })) as KeyRow | null;
  if (!pub || !priv) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const newPub: KeyRow = { id: "public", value: publicKey };
    const newPriv: KeyRow = { id: "private", value: privateKey };
    await ddbPut(KEYS_TABLE, newPub);
    await ddbPut(KEYS_TABLE, newPriv);
    pub = newPub;
    priv = newPriv;
  }
  return wantPublic ? pub.value : priv.value;
}

export async function handler(): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const pubkey = await readOrGenerateKeypair(true);
    return {
      statusCode: 200,
      headers: { "content-type": "application/x-pem-file" },
      body: pubkey,
    };
  } catch (e) {
    return { statusCode: 404, body: JSON.stringify({ message: "Not Found", error: String(e) }) };
  }
}
