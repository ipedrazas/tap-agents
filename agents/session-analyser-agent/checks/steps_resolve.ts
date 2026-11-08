// steps-resolve: every step id the answer cites (t<turn>.s<position>) is a
// step of the session it analysed, and those steps go to findings-supported
// as evidence, so the judge reads what the session actually shows.
//
// The session is the key named in the answer or the task (`<agent>/<id>.json`
// or `t3://<bucket>/<key>`). With step ids and no key there is nothing to
// read them from; that passes with a note, and the judge gets no evidence.
// Reads {task, output, attempt}; prints {pass, reason, details, evidence}.
import { clip, loadSession, SELF_PREFIX, type Session, type Step } from "../tools/session.ts";
import { plural, readInput, result, sessionKeys, STEP_ID } from "./answer.ts";

const MAX_SESSIONS = 3;
const MAX_STEPS = 40;
const FIELD = 1200;

const { task, output } = await readInput();
const cited = [...new Set([...output.matchAll(STEP_ID)].map((m) => m[0]))];
if (cited.length === 0) result(true, "the answer cites no step ids; nothing to resolve");

const keys = [...sessionKeys(output), ...sessionKeys(task)]
  .filter((k, i, all) => all.findIndex((o) => o.bucket === k.bucket && o.key === k.key) === i)
  .filter((k) => !k.key.startsWith(SELF_PREFIX))
  .slice(0, MAX_SESSIONS);
if (keys.length === 0) result(true, `${plural(cited.length, "step id")} cited but no session key in the task or answer; not checked`);

const sessions: { bucket: string; key: string; session: Session }[] = [];
for (const k of keys) {
  const loaded = await loadSession(k.bucket, k.key);
  if ("error" in loaded) result(false, `could not read ${k.key} to check the cited steps: ${String(loaded.error.error)}`, loaded.error);
  sessions.push({ ...k, session: loaded.session });
}

function view(s: Step) {
  return s.kind === "tool"
    ? { id: s.id, kind: "tool", name: s.name, args: clip(JSON.stringify(s.args), FIELD), error: s.error, result: clip(s.result, FIELD) }
    : { id: s.id, kind: "llm", stop_reason: s.stop_reason, tool_calls: s.tool_calls, tokens: s.tokens, context_used: s.context_used, text: clip(s.text, FIELD) };
}

const missing: string[] = [];
const evidence: { key: string; agent: string | null; agent_version: string | null; turns: Record<string, { trigger: string | null; prompt: string; total_steps: number }>; steps: unknown[] }[] =
  sessions.map((s) => ({ key: s.key, agent: s.session.agent, agent_version: s.session.agent_version, turns: {}, steps: [] }));
for (const id of cited.slice(0, MAX_STEPS)) {
  const [, t] = /^t(\d+)\.s(\d+)$/.exec(id)!;
  let hit = false;
  sessions.forEach((s, i) => {
    const turn = s.session.turns.find((x) => x.index === Number(t));
    const step = turn?.steps.find((x) => x.id === id);
    if (!turn || !step) return;
    hit = true;
    evidence[i]!.turns[`t${turn.index}`] ??= { trigger: turn.trigger, prompt: clip(turn.prompt, FIELD), total_steps: turn.steps.length };
    evidence[i]!.steps.push(view(step));
  });
  if (!hit) {
    const turn = sessions[0]!.session.turns.find((x) => x.index === Number(t));
    missing.push(turn ? `${id} (turn ${t} has ${turn.steps.length} steps)` : `${id} (no turn ${t}; the session has ${sessions[0]!.session.turns.length})`);
  }
}

if (missing.length) {
  result(false, `${plural(missing.length, "cited step")} ${missing.length === 1 ? "is" : "are"} not in ${keys.map((k) => k.key).join(", ")}: ${missing.slice(0, 10).join(", ")}`, { missing }, evidence);
}
result(true, `all ${plural(cited.length, "cited step")} found in ${keys.map((k) => k.key).join(", ")}`, undefined, evidence);
