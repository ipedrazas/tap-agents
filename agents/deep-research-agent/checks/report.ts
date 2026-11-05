// Parse a deep-research report (the format system.md asks for) and read a
// check's input. Shared by the deterministic checks.
//
//   # Title
//   Body under ## headings; every factual sentence ends with [n] citations.
//   ## Sources
//   1. Page title — https://example.com/page

import { writeSync } from "node:fs";

export type Input = { task: string; output: string; attempt: number };

export type Source = { n: number; title: string; url: string; line: string };

export type Claim = { text: string; cites: number[] };

export type Report = { body: string; sources: Source[]; hasSources: boolean; claims: Claim[] };

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

// n things, with the noun pluralised: plural(1, "source") is "1 source".
export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

const SOURCES_HEADING = /^#{1,3}\s*(sources|references)\s*$/im;
const SOURCE_LINE = /^\s*(?:\[(\d+)\]|(\d+)[.)])\s+(.*?)(https?:\/\/[^\s<>()\]]+)\s*$/;
const CITE = /\[(\d+)\]/g;

export function parseReport(text: string): Report {
  const m = SOURCES_HEADING.exec(text);
  const body = m ? text.slice(0, m.index) : text;
  const tail = m ? text.slice(m.index + m[0].length) : "";
  const sources: Source[] = [];
  for (const line of tail.split("\n")) {
    if (/^#{1,3}\s/.test(line)) break; // a section after Sources
    const s = SOURCE_LINE.exec(line);
    if (s) {
      const title = s[3]!.replace(/\s*[—–-]\s*$/, "").trim();
      sources.push({ n: Number(s[1] ?? s[2]), title, url: s[4]!.replace(/[.,;]+$/, ""), line: line.trim() });
    }
  }
  return { body, sources, hasSources: Boolean(m), claims: claims(body) };
}

// Words that end in a full stop without ending the sentence: "decree no. 2025-1362",
// "e.g. Lyon", "et al. 2021", "U.S. Census". Single letters (initials) count too.
const ABBREVIATIONS = new Set([
  "no", "nos", "nr", "num", "e.g", "i.e", "etc", "vs", "cf", "approx", "ca", "c", "art", "arts", "sec", "ch", "p", "pp", "para",
  "fig", "figs", "tab", "vol", "vols", "ed", "eds", "rev", "al", "op", "dr", "mr", "mrs", "ms", "prof", "st", "jr", "sr",
  "inc", "ltd", "co", "corp", "dept", "est", "u.s", "u.k", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept",
  "oct", "nov", "dec", "mt", "ft", "km", "min", "max", "avg",
]);

// sentences splits a paragraph at ".", "!" or "?" followed by a space and
// a capital, digit or opening quote, except after an abbreviation.
export function sentences(p: string): string[] {
  const out: string[] = [];
  const end = /[.!?](?=\s+["“'(\[]?[\p{Lu}0-9])/gu;
  let start = 0;
  for (let m = end.exec(p); m; m = end.exec(p)) {
    const word = (/([\p{L}.]+)$/u.exec(p.slice(start, m.index))?.[1] ?? "").toLowerCase();
    if (m[0] === "." && (ABBREVIATIONS.has(word) || /^\p{L}$/u.test(word))) continue;
    out.push(p.slice(start, m.index + 1));
    start = m.index + 1;
  }
  out.push(p.slice(start));
  return out;
}

// claims splits the body into the sentences that must carry a citation:
// every sentence of prose and every list item, but not headings, code,
// tables, questions, lead-ins ending in ":", fragments of fewer than four words, or "> Note:" lines,
// where the agent says what it could not find (system.md).
export function claims(body: string): Claim[] {
  const out: Claim[] = [];
  let inCode = false;
  const paragraphs: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length) paragraphs.push(cur.join(" "));
    cur = [];
  };
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      inCode = !inCode;
      flush();
      continue;
    }
    if (inCode || line === "" || /^#{1,6}\s/.test(line) || line.startsWith("|") || /^[-*_]{3,}$/.test(line) || /^>\s*note:/i.test(line)) {
      flush();
      continue;
    }
    if (/^([-*+]|\d+[.)])\s+/.test(line)) {
      flush();
      cur.push(line.replace(/^([-*+]|\d+[.)])\s+/, ""));
      flush();
      continue;
    }
    cur.push(line.replace(/^>\s?/, ""));
  }
  flush();
  for (const p of paragraphs) {
    // Markdown links read as their text; citations after the full stop
    // belong to the sentence before it.
    const norm = p.replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1").replace(/([.!?])((?:\s*\[\d+\])+)/g, "$2$1");
    for (const s of sentences(norm)) {
      const text = s.trim();
      // Questions, fragments, and lead-ins to a list ("Comparing the two:") make no claim.
      if (text.split(/\s+/).length < 4 || text.endsWith("?") || text.endsWith(":")) continue;
      const cites = [...text.matchAll(CITE)].map((c) => Number(c[1]));
      out.push({ text, cites });
    }
  }
  return out;
}
