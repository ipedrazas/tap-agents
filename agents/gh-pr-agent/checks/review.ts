// Read a check's input, print its verdict, and parse a gh-pr-agent review in
// either format system.md allows: the markdown answer format, or the JSON
// object returned when the person asks for JSON. Shared by the checks.

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

export const VERDICTS = ["Blocking issues found", "Worth fixing before merge", "No issues worth raising"];
export const SEVERITIES = ["Critical", "Warning", "Suggestion"];

export type Citation = { path: string; start: number; end: number };
export type Finding = { severity: string; title: string; citations: Citation[] };
export type Review = {
  format: "markdown" | "json";
  verdict: string | null; // one of VERDICTS, or null when the answer states none
  findings: Finding[];
  hasCoverage: boolean;
  problems: string[]; // shape problems found while parsing
};

// path/to/file.ext:L42-L47, :L42-47 or :L42, optionally in backticks.
const CITE = /([A-Za-z0-9_.@+~\/-]*[A-Za-z0-9_@+~-][A-Za-z0-9_.@+~\/-]*):L(\d+)(?:\s*[-–]\s*L?(\d+))?/g;

export function citations(text: string): Citation[] {
  return [...text.matchAll(CITE)].map((m) => {
    const start = Number(m[2]);
    return { path: m[1]!.replace(/^\.?\//, ""), start, end: m[3] ? Number(m[3]) : start };
  });
}

// A finding heading: "**[Severity] Category: title**", optionally after "1.", "-" or "###".
const HEADING = /^\s*(?:#{1,6}\s*|\d+[.)]\s*|[-*+]\s+)?\*\*\[([^\]\n]+)\]\s*(.+?)\*\*/;

function parseMarkdown(text: string): Review {
  const lines = text.split("\n");
  const first = (lines.find((l) => l.trim() !== "") ?? "").replace(/[*_#>`]/g, "").trim().toLowerCase();
  const verdict = VERDICTS.find((v) => first.startsWith(v.toLowerCase())) ?? null;
  const findings: (Finding & { body: string })[] = [];
  let cur: (Finding & { body: string }) | null = null;
  for (const line of lines) {
    if (/^\s*(?:#{1,6}\s*)?(?:\*\*)?coverage\b/i.test(line)) {
      cur = null; // the Coverage section cites files read, not findings
      continue;
    }
    const m = HEADING.exec(line);
    if (m) {
      cur = { severity: m[1]!.trim(), title: m[2]!.trim(), citations: [], body: "" };
      findings.push(cur);
    }
    if (cur) cur.body += line + "\n";
  }
  for (const f of findings) f.citations = citations(f.body);
  return {
    format: "markdown",
    verdict,
    findings: findings.map(({ body: _b, ...f }) => f),
    hasCoverage: /^\s*(?:#{1,6}\s*)?(?:\*\*)?coverage\b/im.test(text),
    problems: [],
  };
}

function parseJson(v: Record<string, unknown>): Review {
  const problems: string[] = [];
  const verdict = typeof v.verdict === "string" ? (VERDICTS.find((x) => x.toLowerCase() === (v.verdict as string).toLowerCase()) ?? null) : null;
  const raw = Array.isArray(v.findings) ? v.findings : (problems.push('"findings" is not an array'), []);
  const findings: Finding[] = raw.map((f: any, i: number) => {
    for (const k of ["severity", "category", "file", "start_line", "end_line", "title", "scenario", "fix"]) {
      if (f?.[k] === undefined || f?.[k] === "") problems.push(`findings[${i}] has no "${k}"`);
    }
    const start = Number(f?.start_line);
    const end = Number(f?.end_line ?? f?.start_line);
    const ok = typeof f?.file === "string" && Number.isInteger(start) && Number.isInteger(end) && start >= 1;
    return { severity: String(f?.severity ?? ""), title: String(f?.title ?? ""), citations: ok ? [{ path: f.file, start, end }] : [] };
  });
  const cov = v.coverage as Record<string, unknown> | undefined;
  return { format: "json", verdict, findings, hasCoverage: !!cov && Array.isArray(cov.reviewed) && Array.isArray(cov.skipped), problems };
}

export function parseReview(output: string): Review {
  const t = output.trim().replace(/^```(?:json)?\s*\n([\s\S]*)\n```$/, "$1");
  if (t.startsWith("{")) {
    try {
      const v = JSON.parse(t);
      if (v && typeof v === "object" && !Array.isArray(v)) return parseJson(v);
    } catch {
      // not JSON after all: read it as markdown
    }
  }
  return parseMarkdown(output);
}

// The PR a task names: a github.com pull URL, or owner/repo#number.
export function prFromTask(task: string): { owner: string; repo: string; number: number } | null {
  const m = /github\.com\/([A-Za-z0-9][A-Za-z0-9._-]{0,99})\/([A-Za-z0-9][A-Za-z0-9._-]{0,99})\/pull\/(\d+)/.exec(task)
    ?? /(?<![\w\/.-])([A-Za-z0-9][A-Za-z0-9._-]{0,99})\/([A-Za-z0-9][A-Za-z0-9._-]{0,99})#(\d+)\b/.exec(task);
  return m ? { owner: m[1]!, repo: m[2]!.replace(/\.git$/, ""), number: Number(m[3]) } : null;
}
