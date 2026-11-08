// report-format: what a script can decide about a session-analyser answer.
// The first line states the verdict ("N findings" or "Nothing worth filing")
// and N matches the findings listed; each finding is "**[kind] title**" with
// a known kind and cites at least one step id; there are at most five per
// session; and an answer with findings says what was filed, or that nothing
// was.
//
// Whether a finding is real, and whether filing matched the request, are
// judgements: findings-supported and filing-matches-request make them.
// Reads {task, output, attempt} on stdin; prints {pass, reason, details}.
import { findings, KINDS, plural, readInput, result, sessionKeys, verdict } from "./answer.ts";

const { output } = await readInput();
const fs = findings(output);
const v = verdict(output);
const sessions = Math.max(1, sessionKeys(output).length);

const problems: string[] = [];
if (v === undefined) {
  problems.push('the first line has no verdict: end it with "N findings" or "Nothing worth filing"');
} else if (sessions === 1 && (v ?? 0) !== fs.length) {
  problems.push(`the verdict says ${v === null ? "nothing worth filing" : plural(v, "finding")} but the answer lists ${plural(fs.length, "finding")}`);
}
const badKind = fs.filter((f) => !KINDS.includes(f.kind));
if (badKind.length) problems.push(`unknown kind ${badKind.map((f) => `[${f.kind}]`).join(", ")}; use one of ${KINDS.join(", ")}`);
const noSteps = fs.filter((f) => f.stepIds.length === 0);
if (noSteps.length) problems.push(`${plural(noSteps.length, "finding")} cite${noSteps.length === 1 ? "s" : ""} no step id (t<turn>.s<position>)`);
if (fs.length > 5 * sessions) problems.push(`${plural(fs.length, "finding")} for ${plural(sessions, "session")}; at most five per session, merge symptoms of one cause`);
if (fs.length > 0 && !/not filed|didn'?t file|did not file|could not file|filing failed|linear\.app\/|\b[A-Z][A-Z0-9]{1,9}-\d+\b/i.test(output)) {
  problems.push('the answer has findings but does not say what was filed: give the issue ids or URLs, the filing error, or "not filed: not asked to"');
}

const details = { findings: fs.map((f) => ({ kind: f.kind, title: f.title.slice(0, 120), step_ids: f.stepIds.slice(0, 10) })) };
if (problems.length === 0) {
  result(true, fs.length ? `${plural(fs.length, "finding")}, each with a known kind and step ids` : "nothing worth filing", details);
}
result(false, problems.join("; "), details);
