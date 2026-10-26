// Minimal S3 client for the Tigris sessions bucket: path-style requests signed
// with AWS SigV4 (region "auto"), standard library only.
import { createHash, createHmac } from "node:crypto";

export const ENDPOINT_HOST = "t3.storage.dev";
const REGION = "auto";
const SERVICE = "s3";
const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");

// S3's URI encoding: everything but unreserved characters, keeping "/" in paths.
function encode(s: string, keepSlash: boolean): string {
  return Array.from(new TextEncoder().encode(s))
    .map((b) => {
      const c = String.fromCharCode(b);
      if (/[A-Za-z0-9\-._~]/.test(c) || (keepSlash && c === "/")) return c;
      return "%" + b.toString(16).toUpperCase().padStart(2, "0");
    })
    .join("");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

// The URL the tool requests: https://t3.storage.dev/<bucket>/<key>?<sorted query>.
export function objectUrl(bucket: string, key: string, query: Record<string, string> = {}): string {
  const path = "/" + encode(bucket, false) + (key ? "/" + encode(key, true) : "");
  const qs = Object.keys(query)
    .sort()
    .map((k) => encode(k, false) + "=" + encode(query[k], false))
    .join("&");
  return `https://${ENDPOINT_HOST}${path}${qs ? "?" + qs : ""}`;
}

function sign(url: URL, now: Date): Record<string, string> {
  const accessKey = process.env.SESSIONS_ACCESS_KEY_ID ?? "";
  const secretKey = process.env.SESSIONS_SECRET_ACCESS_KEY ?? "";
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": EMPTY_SHA256,
    "x-amz-date": amzDate,
  };
  const signed = Object.keys(headers).sort();
  const canonical = [
    "GET",
    url.pathname,
    url.search.slice(1),
    signed.map((h) => `${h}:${headers[h]}\n`).join(""),
    signed.join(";"),
    EMPTY_SHA256,
  ].join("\n");
  const scope = `${day}/${REGION}/${SERVICE}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  const kSigning = hmac(hmac(hmac(hmac("AWS4" + secretKey, day), REGION), SERVICE), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signed.join(";")}, Signature=${signature}`;
  return headers;
}

export type S3Result = { ok: true; status: number; text: string } | { ok: false; status: number; code: string };

export async function s3Get(url: string): Promise<S3Result> {
  const u = new URL(url);
  const headers = sign(u, new Date());
  delete headers.host;
  const res = await fetch(u, { headers, signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  if (res.ok) return { ok: true, status: res.status, text };
  const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? "upstream";
  return { ok: false, status: res.status, code };
}

// Error object for the model, from a failed S3 call.
export function s3Error(r: { status: number; code: string }, extra: Record<string, unknown>) {
  const error = r.status === 404 || r.code === "NoSuchKey" || r.code === "NoSuchBucket" ? "not_found"
    : r.status === 403 ? "forbidden"
    : "upstream";
  return { error, status: r.status, code: r.code, ...extra };
}
