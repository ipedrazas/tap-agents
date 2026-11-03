// citations-wellformed: what a script can decide about a report's citations.
// It has a Sources list, every citation points at a listed source, every
// source is cited, and no sentence that states a figure (a number, a date)
// goes without a citation.
//
// Which other sentences are claims that need a source is a judgement: a
// lead-in, a transition or the report's own reasoning is not a claim, and no
// rule about punctuation tells them apart. claims-supported (judged) decides
// that. Reads {task, output, attempt} on stdin; prints {pass, reason, details}.
import { parseReport, plural, readInput, result } from "./report.ts";

const MAX_LISTED = 20;
const { output } = await readInput();
const report = parseReport(output);

if (!report.hasSources) result(false, 'the report has no "## Sources" section');
if (report.sources.length === 0) result(false, 'the "## Sources" section lists no sources in the form "1. Title — https://…"');

const listed = new Set(report.sources.map((s) => s.n));
const cited = new Set(report.claims.flatMap((c) => c.cites));
if (cited.size === 0) result(false, "the report cites none of its sources");
const dangling = [...cited].filter((n) => !listed.has(n)).sort((a, b) => a - b);
const unused = report.sources.filter((s) => !cited.has(s.n)).map((s) => s.n);
// A figure is the one kind of statement that is a claim whatever its wording.
const uncitedFigures = report.claims.filter((c) => c.cites.length === 0 && /\d/.test(c.text));

const problems: string[] = [];
if (uncitedFigures.length) {
  problems.push(`${plural(uncitedFigures.length, "statement")} with a figure ${uncitedFigures.length === 1 ? "has" : "have"} no citation`);
}
if (dangling.length) problems.push(`cites ${dangling.map((n) => `[${n}]`).join(", ")} but Sources does not list ${dangling.length === 1 ? "it" : "them"}`);
if (unused.length) problems.push(`Sources lists ${unused.join(", ")} but the report never cites ${unused.length === 1 ? "it" : "them"}`);

if (problems.length === 0) {
  result(true, `${plural(report.sources.length, "source")}, all cited; every figure is cited`);
}
result(false, problems.join("; "), {
  uncited_figures: uncitedFigures.slice(0, MAX_LISTED).map((c) => c.text.slice(0, 300)),
  dangling,
  unused,
});
