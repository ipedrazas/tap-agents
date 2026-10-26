// Deterministic digest of one session: totals, per-tool stats, per-turn
// prompts and answers, and signals worth a closer look.
import { parseArgs } from "node:util";
import { clip, loadSession, type LlmStep, type ToolStep } from "./session.ts";

const LARGE_RESULT_CHARS = 40_000;
const SLOW_LLM_MS = 60_000;
const HIGH_CONTEXT = 100_000;
const HEAVY_TOOL_CALLS = 15; // calls to one tool in one turn
const DONE = new Set(["stop", "end_turn", "end"]);
const MAX_TURNS_LISTED = 30;
const MAX_IDS = 10;

const { values } = parseArgs({ options: { bucket: { type: "string" }, key: { type: "string" } }, strict: true });
const loaded = await loadSession(values.bucket!, values.key!);
if ("error" in loaded) {
  process.stdout.write(JSON.stringify(loaded.error));
  process.exit(0);
}
const s = loaded.session;
const steps = s.turns.flatMap((t) => t.steps);
const tools = steps.filter((x): x is ToolStep => x.kind === "tool");
const llms = steps.filter((x): x is LlmStep => x.kind === "llm");

const perTool: Record<string, { calls: number; errors: number; max_latency_ms: number | null; max_result_chars: number }> = {};
for (const t of tools) {
  const p = (perTool[t.name] ??= { calls: 0, errors: 0, max_latency_ms: null, max_result_chars: 0 });
  p.calls++;
  if (t.error) p.errors++;
  if (t.latency_ms !== null) p.max_latency_ms = Math.max(p.max_latency_ms ?? 0, t.latency_ms);
  p.max_result_chars = Math.max(p.max_result_chars, t.result.length);
}

const signals: Record<string, unknown>[] = [];

const errorsByTool = new Map<string, ToolStep[]>();
for (const t of tools.filter((t) => t.error)) errorsByTool.set(t.name, [...(errorsByTool.get(t.name) ?? []), t]);
for (const [name, errs] of errorsByTool) {
  signals.push({ type: "tool_error", tool: name, count: errs.length, steps: errs.slice(0, MAX_IDS).map((e) => e.id), first_error: clip(errs[0].result, 300) });
}

const byCall = new Map<string, ToolStep[]>();
for (const t of tools) {
  const k = t.name + " " + JSON.stringify(t.args);
  byCall.set(k, [...(byCall.get(k) ?? []), t]);
}
for (const same of byCall.values()) {
  if (same.length > 1) signals.push({ type: "repeated_call", tool: same[0].name, count: same.length, steps: same.slice(0, MAX_IDS).map((x) => x.id), args: clip(JSON.stringify(same[0].args), 200) });
}

for (const t of tools.filter((t) => t.result.length > LARGE_RESULT_CHARS)) {
  signals.push({ type: "large_result", tool: t.name, step: t.id, chars: t.result.length });
}

for (const l of llms.filter((l) => (l.latency_ms ?? 0) > SLOW_LLM_MS)) {
  signals.push({ type: "slow_llm_call", step: l.id, latency_ms: l.latency_ms, output_tokens: l.tokens.output, reasoning_tokens: l.tokens.reasoning });
}

const maxContext = Math.max(0, ...llms.map((l) => l.context_used ?? 0));
if (maxContext > HIGH_CONTEXT) signals.push({ type: "high_context", max_context_used: maxContext });

const turns = s.turns.map((t) => {
  const tl = t.steps.filter((x): x is LlmStep => x.kind === "llm");
  const last = t.steps[t.steps.length - 1];
  const finished = last?.kind === "llm" && DONE.has(last.stop_reason ?? "");
  if (t.steps.length > 0 && !finished) {
    signals.push({ type: "unfinished_turn", turn: t.index, last_step: last.id, last_kind: last.kind, stop_reason: last.kind === "llm" ? last.stop_reason : null });
  }
  const counts: Record<string, number> = {};
  for (const x of t.steps) if (x.kind === "tool") counts[x.name] = (counts[x.name] ?? 0) + 1;
  for (const [name, n] of Object.entries(counts)) {
    if (n >= HEAVY_TOOL_CALLS) signals.push({ type: "heavy_tool_use", turn: t.index, tool: name, count: n });
  }
  const answer = [...tl].reverse().find((l) => l.text.trim() !== "");
  return {
    turn: t.index,
    trigger: t.trigger,
    prompt: clip(t.prompt, 300),
    llm_calls: tl.length,
    tool_calls: counts,
    tool_errors: t.steps.filter((x) => x.kind === "tool" && x.error).length,
    final_answer: answer ? clip(answer.text, 800) : null,
    final_step: answer?.id ?? null,
  };
});

const sum = (f: (l: LlmStep) => number) => llms.reduce((a, l) => a + f(l), 0);
process.stdout.write(JSON.stringify({
  bucket: values.bucket,
  key: values.key,
  format: s.format,
  session_id: s.session_id,
  agent: s.agent,
  agent_version: s.agent_version,
  prompt_version: s.prompt_version,
  models: [...new Set(llms.map((l) => l.model).filter(Boolean))],
  start_time: s.start_time,
  end_time: s.end_time,
  object_bytes: loaded.bytes,
  totals: {
    turns: s.turns.length,
    llm_calls: llms.length,
    tool_calls: tools.length,
    tool_errors: tools.filter((t) => t.error).length,
    tokens: { input: sum((l) => l.tokens.input), output: sum((l) => l.tokens.output), cache_read: sum((l) => l.tokens.cache_read), reasoning: sum((l) => l.tokens.reasoning) },
    max_context_used: maxContext || null,
  },
  tools: perTool,
  signals,
  turns: turns.slice(0, MAX_TURNS_LISTED),
  turns_truncated: turns.length > MAX_TURNS_LISTED,
}));
