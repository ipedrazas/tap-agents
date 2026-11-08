// citations-resolve: every path:L<n> a finding cites names a file and lines
// that exist in the PR, at the head sha (new code) or, for removed lines, the
// base sha. The cited lines, with a little context, go to findings-grounded
// as evidence, so the judge reads the code the finding is about.
//
// The PR comes from the task (a github.com pull URL or owner/repo#n). A task
// that names no PR, or a review with no findings, passes with a note.
// Reads {task, output, attempt}; prints {pass, reason, details, evidence}.
import { contentsUrl, gh, pullsUrl } from "../tools/github.ts";
import { parseReview, plural, prFromTask, readInput, result } from "./review.ts";

const MAX_FILES = 10;
const CONTEXT = 5;
const MAX_LINES = 60;

const { task, output } = await readInput();
const review = parseReview(output);
const cites = review.findings.flatMap((f) => f.citations.map((c) => ({ ...c, finding: f.title.slice(0, 80) })));
if (cites.length === 0) result(true, "no finding cites lines; nothing to resolve");
const pr = prFromTask(task);
if (!pr) result(true, `${plural(cites.length, "citation")} but the task names no PR; not checked`);

const meta = await gh(pullsUrl(pr.owner, pr.repo, pr.number));
if (!meta.ok) result(false, `could not read ${pr.owner}/${pr.repo}#${pr.number} to check the citations: ${String(meta.error.error)}`, meta.error);
const p = JSON.parse(meta.text);
const headSha: string = p.head?.sha;
const baseSha: string = p.base?.sha;
const headRepo: string = p.head?.repo?.full_name ?? `${pr.owner}/${pr.repo}`;

// Files are read once each: at head (from the fork for fork PRs), then base.
const cache = new Map<string, { ref: "head" | "base"; lines: string[] } | null>();
async function read(repoFull: string, path: string, ref: string): Promise<string[] | null> {
  const [o, r] = repoFull.split("/");
  const res = await gh(contentsUrl(o!, r!, path, ref), /* raw = */ true, 20_000);
  if (!res.ok) {
    if (res.error.error === "not_found") return null;
    result(false, `could not read ${path} to check its citation: ${String(res.error.error)}`, res.error);
  }
  const lines = res.text.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
async function load(path: string) {
  if (cache.has(path)) return cache.get(path)!;
  if (cache.size >= MAX_FILES) return undefined;
  const head = await read(headRepo, path, headSha);
  const base = head ? null : await read(`${pr!.owner}/${pr!.repo}`, path, baseSha);
  const v = head ? { ref: "head" as const, lines: head } : base ? { ref: "base" as const, lines: base } : null;
  cache.set(path, v);
  return v;
}

const bad: string[] = [];
const evidence: unknown[] = [];
for (const c of cites) {
  const f = await load(c.path);
  if (f === undefined) continue; // over the file budget: not checked
  const at = `${c.path}:L${c.start}${c.end !== c.start ? `-L${c.end}` : ""}`;
  if (f === null) {
    bad.push(`${at}: no such file at the head or base sha`);
    continue;
  }
  if (c.end > f.lines.length) {
    bad.push(`${at}: ${c.path} has ${f.lines.length} lines at the ${f.ref} sha`);
    continue;
  }
  const from = Math.max(1, c.start - CONTEXT);
  const to = Math.min(f.lines.length, c.end + CONTEXT, from + MAX_LINES - 1);
  const lines = [];
  for (let n = from; n <= to; n++) lines.push(`${n}${n >= c.start && n <= c.end ? ">" : " "} ${f.lines[n - 1]!.slice(0, 300)}`);
  evidence.push({ finding: c.finding, citation: at, ref: f.ref, sha: f.ref === "head" ? headSha : baseSha, lines: lines.join("\n") });
}

const pull = { pr: `${pr.owner}/${pr.repo}#${pr.number}`, title: String(p.title ?? "").slice(0, 200) };
if (bad.length) result(false, `${plural(bad.length, "citation")} point${bad.length === 1 ? "s" : ""} at lines that don't exist: ${bad.slice(0, 8).join("; ")}`, { bad }, { pull, cited: evidence });
result(true, `${plural(evidence.length, "citation")} resolved in ${pull.pr}`, undefined, { pull, cited: evidence });
