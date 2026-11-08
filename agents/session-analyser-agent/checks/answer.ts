// Read a check's input, print its verdict, and parse a session-analyser
// answer (the format system.md asks for). Shared by the deterministic checks.
//
//   <session line> — 2 findings
//   **[tool-use] get_file called 18 times for one file**  (evidence t0.s7, ...)
//   **[cost] ...**
//   Filed: ENG-42 (created), ENG-17 (updated)  |  not filed: not asked to

import { writeSync } from "node:fs";

export type Input = { task: string; output: string; attempt: number };

export async function readInput(): Promise<Input> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Input;
}

// result prints the check's verdict and exits. The write is synchronous:
// process.stdout on a pipe may be asynchronous, and exit would cut it off.
export function result(pass: boolean, reason: string, details?: unknown, evidence?: unknown): never {
  const out = Buffer.from(JSON.stringify({ pass, reason, ...(details === undefined ? {} : { details }), ...(evidence === undefined ? {} : { evidence }) }));
  for (let off = 0; off < out.length; ) {
    try {
      off += writeSync(1, out, off);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EAGAIN") throw e;
    }
  }
  process.exit(0);
}

export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export const KINDS = ["tool-use", "error-handling", "instructions", "cost", "tool-defect"];

export type Finding = { kind: string; title: string; body: string; stepIds: string[] };

// A finding heading: "**[kind] title**", optionally after "1.", "-" or "###".
const HEADING = /^\s*(?:#{1,6}\s*|\d+[.)]\s*|[-*+]\s+)?\*\*\[([^\]\n]+)\]\s*(.+?)\*\*/;
export const STEP_ID = /\bt(\d+)\.s(\d+)\b/g;

export function findings(text: string): Finding[] {
  const out: Finding[] = [];
  let cur: Finding | null = null;
  for (const line of text.split("\n")) {
    const m = HEADING.exec(line);
    if (m) {
      cur = { kind: m[1]!.trim().toLowerCase(), title: m[2]!.trim(), body: "", stepIds: [] };
      out.push(cur);
    }
    if (cur) cur.body += line + "\n";
  }
  for (const f of out) f.stepIds = [...new Set([...f.body.matchAll(STEP_ID)].map((s) => s[0]))];
  return out;
}

// The verdict on the answer's first non-empty line: a count, or null for
// "Nothing worth filing", or undefined when the line states neither.
export function verdict(text: string): number | null | undefined {
  const first = text.split("\n").find((l) => l.trim() !== "") ?? "";
  if (/nothing worth filing/i.test(first)) return null;
  const m = /\b(\d+)\s+findings?\b/i.exec(first);
  if (m) return Number(m[1]);
  if (/\bone finding\b/i.test(first)) return 1;
  return undefined;
}

// Session object keys named in a text, with their bucket when written as
// t3://<bucket>/<key>.
const K = "[a-z0-9][a-z0-9-]{0,62}\\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\\.json";
const KEY = new RegExp(`t3:\\/\\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])\\/(${K})\\b|(?<![A-Za-z0-9._\\/:-])(${K})\\b`, "g");
export const DEFAULT_BUCKET = "hiddenfield-tap-sessions";

export function sessionKeys(text: string): { bucket: string; key: string }[] {
  const seen = new Map<string, { bucket: string; key: string }>();
  for (const m of text.matchAll(KEY)) {
    const bucket = m[1] ?? DEFAULT_BUCKET;
    const key = (m[2] ?? m[3])!;
    if (!seen.has(`${bucket}/${key}`)) seen.set(`${bucket}/${key}`, { bucket, key });
  }
  return [...seen.values()];
}
