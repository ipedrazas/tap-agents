// Lists session objects under one agent's prefix, newest first.
import { parseArgs } from "node:util";
import { objectUrl, s3Error, s3Get, ENDPOINT_HOST } from "./s3.ts";
import { SELF_PREFIX } from "./session.ts";

const { values } = parseArgs({ options: { bucket: { type: "string" }, prefix: { type: "string" }, limit: { type: "string" } }, strict: true });
const prefix = values.prefix!.endsWith("/") ? values.prefix! : values.prefix! + "/";
const limit = Number(values.limit);
if (prefix === SELF_PREFIX) {
  process.stdout.write(JSON.stringify({ error: "self_session", prefix, message: "this agent does not analyse its own sessions" }));
  process.exit(0);
}
const r = await s3Get(objectUrl(values.bucket!, "", { "list-type": "2", "max-keys": "1000", prefix }));
if (!r.ok) {
  process.stdout.write(JSON.stringify(s3Error(r, { bucket: values.bucket, prefix })));
  process.exit(0);
}
const tag = (block: string, name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(block)?.[1] ?? "";
const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const objects = [...r.text.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)]
  .map((m) => ({ key: unescape(tag(m[1], "Key")), size: Number(tag(m[1], "Size")), last_modified: tag(m[1], "LastModified") }))
  .filter((o) => o.key.endsWith(".json"))
  .sort((a, b) => b.last_modified.localeCompare(a.last_modified));
process.stdout.write(JSON.stringify({
  endpoint: ENDPOINT_HOST,
  bucket: values.bucket,
  prefix,
  total_listed: objects.length,
  listing_truncated: tag(r.text, "IsTruncated") === "true",
  sessions: objects.slice(0, limit),
}));
