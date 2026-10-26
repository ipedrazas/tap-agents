// A window of one turn's steps with arguments, results and model text, clipped
// to max_chars per field, so findings can cite what actually happened.
import { parseArgs } from "node:util";
import { clip, loadSession } from "./session.ts";

const { values } = parseArgs({
  options: {
    bucket: { type: "string" }, key: { type: "string" }, turn: { type: "string" },
    from: { type: "string" }, count: { type: "string" }, max_chars: { type: "string" },
  },
  strict: true,
});
const turnIndex = Number(values.turn);
const from = Number(values.from);
const count = Number(values.count);
const maxChars = Number(values.max_chars);

const loaded = await loadSession(values.bucket!, values.key!);
if ("error" in loaded) {
  process.stdout.write(JSON.stringify(loaded.error));
  process.exit(0);
}
const turn = loaded.session.turns.find((t) => t.index === turnIndex);
if (!turn) {
  process.stdout.write(JSON.stringify({ error: "no_such_turn", turn: turnIndex, turns: loaded.session.turns.map((t) => t.index) }));
  process.exit(0);
}
const window = turn.steps.slice(from, from + count).map((x) =>
  x.kind === "tool"
    ? { id: x.id, kind: "tool", name: x.name, args: clip(JSON.stringify(x.args), maxChars), error: x.error, latency_ms: x.latency_ms, result: clip(x.result, maxChars) }
    : { id: x.id, kind: "llm", model: x.model, stop_reason: x.stop_reason, tool_calls: x.tool_calls, tokens: x.tokens, context_used: x.context_used, latency_ms: x.latency_ms, text: clip(x.text, maxChars), thinking: clip(x.thinking, maxChars) },
);
process.stdout.write(JSON.stringify({
  key: values.key,
  turn: turn.index,
  prompt: clip(turn.prompt, maxChars),
  total_steps: turn.steps.length,
  from,
  steps: window,
  next_from: from + count < turn.steps.length ? from + count : null,
}));
