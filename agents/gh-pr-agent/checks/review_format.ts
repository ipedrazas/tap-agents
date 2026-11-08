// review-format: what a script can decide about a gh-pr-agent review. The
// verdict is one of the three, and the findings decide it (Blocking only with
// a Critical, No issues only with none); each finding has a known severity and
// a path:L<n> citation; at most five; and the review has a Coverage section.
// JSON answers are checked against the JSON shape system.md gives instead.
//
// Whether a finding is true is a judgement: findings-grounded makes it.
// Reads {task, output, attempt} on stdin; prints {pass, reason, details}.
import { parseReview, plural, readInput, result, SEVERITIES, VERDICTS } from "./review.ts";

const { output } = await readInput();
const r = parseReview(output);
const problems = [...r.problems];

if (r.verdict === null) {
  problems.push(r.format === "json" ? `"verdict" is not one of: ${VERDICTS.join(", ")}` : `the first line is not a verdict: start it with one of ${VERDICTS.map((v) => `"${v}"`).join(", ")}`);
}
const badSev = r.findings.filter((f) => !SEVERITIES.includes(f.severity));
if (badSev.length) problems.push(`unknown severity ${[...new Set(badSev.map((f) => `[${f.severity}]`))].join(", ")}; use Critical, Warning or Suggestion`);
const uncited = r.findings.filter((f) => f.citations.length === 0);
if (uncited.length) problems.push(`${plural(uncited.length, "finding")} ha${uncited.length === 1 ? "s" : "ve"} no path:L<n> citation (${uncited.map((f) => `"${f.title.slice(0, 60)}"`).join(", ")})`);
const backwards = r.findings.flatMap((f) => f.citations).filter((c) => c.end < c.start);
if (backwards.length) problems.push(`citation ranges run backwards: ${backwards.map((c) => `${c.path}:L${c.start}-L${c.end}`).join(", ")}`);
if (r.findings.length > 5) problems.push(`${plural(r.findings.length, "finding")}; at most five, merge symptoms of one root cause`);

if (r.verdict !== null) {
  const critical = r.findings.some((f) => f.severity === "Critical");
  const expected = critical ? VERDICTS[0] : r.findings.length > 0 ? VERDICTS[1] : VERDICTS[2];
  if (r.verdict !== expected) {
    problems.push(`the verdict is "${r.verdict}" but the findings (${r.findings.length ? r.findings.map((f) => f.severity).join(", ") : "none"}) make it "${expected}"`);
  }
}
if (!r.hasCoverage) problems.push(r.format === "json" ? '"coverage" needs "reviewed" and "skipped" arrays' : "the review has no Coverage section");

const details = { format: r.format, verdict: r.verdict, findings: r.findings.map((f) => ({ severity: f.severity, title: f.title.slice(0, 120), citations: f.citations.slice(0, 5) })) };
if (problems.length === 0) result(true, `${r.verdict}; ${plural(r.findings.length, "finding")}, each cited`, details);
result(false, problems.join("; "), details);
