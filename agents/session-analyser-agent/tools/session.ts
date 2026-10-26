// Loads a session object from the bucket and normalises both formats we store:
// tap/casa trace documents (trace_version 1) and pi agent message logs
// ({sessionId, messages[]}), into one shape of turns and steps.
import { objectUrl, s3Error, s3Get } from "./s3.ts";

export const SELF_PREFIX = "session-analyser-agent/";

export type ToolStep = {
  id: string;
  kind: "tool";
  name: string;
  args: unknown;
  result: string;
  error: boolean;
  latency_ms: number | null;
};

export type LlmStep = {
  id: string;
  kind: "llm";
  model: string | null;
  stop_reason: string | null;
  text: string;
  thinking: string;
  tool_calls: string[]; // tool names requested
  tokens: { input: number; output: number; cache_read: number; reasoning: number };
  context_used: number | null;
  latency_ms: number | null;
};

export type Step = ToolStep | LlmStep;

export type Turn = { index: number; trigger: string | null; prompt: string; steps: Step[] };

export type Session = {
  format: "tap-trace-v1" | "pi-messages";
  session_id: string;
  agent: string | null;
  agent_version: string | null;
  prompt_version: string | null;
  start_time: string | null;
  end_time: string | null;
  turns: Turn[];
};

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));

// A tool result is an error when the runner says so or the tool returned {"error": ...}.
function resultIsError(result: string): boolean {
  const t = result.trimStart();
  if (!t.startsWith("{")) return /^error\b/i.test(t);
  try {
    const v = JSON.parse(t);
    return v !== null && typeof v === "object" && "error" in v;
  } catch {
    return false;
  }
}

function fromTrace(doc: any): Session {
  const turns: Turn[] = (doc.turns ?? []).map((t: any, i: number) => {
    const ti = typeof t.turn_index === "number" ? t.turn_index : i;
    const byId = new Map<string, any>((t.steps ?? []).map((x: any) => [x.step_id, x]));
    const steps: Step[] = (t.steps ?? []).flatMap((s: any, j: number): Step[] => {
      const id = `t${ti}.s${typeof s.step_index === "number" ? s.step_index : j}`;
      if (s.kind === "tool_call" && s.tool_call) {
        const c = s.tool_call;
        const result = str(c.result);
        return [{
          id, kind: "tool", name: str(c.name), args: c.arguments ?? null, result,
          error: (c.status && c.status !== "ok") || resultIsError(result),
          latency_ms: typeof c.latency_ms === "number" ? c.latency_ms : null,
        }];
      }
      if (s.kind === "llm_call" && s.llm_call) {
        const c = s.llm_call;
        return [{
          id, kind: "llm", model: c.response_model ?? c.model ?? null, stop_reason: c.stop_reason ?? null,
          text: str(c.text), thinking: str(c.reasoning_text ?? c.thinking),
          tool_calls: (c.tool_call_ids ?? []).map((x: string) => str(byId.get(x)?.tool_call?.name) || x),
          tokens: { input: num(c.tokens?.input), output: num(c.tokens?.output), cache_read: num(c.tokens?.cache_read), reasoning: num(c.tokens?.reasoning) },
          context_used: typeof c.context_used === "number" ? c.context_used : null,
          latency_ms: typeof c.latency_ms === "number" ? c.latency_ms : null,
        }];
      }
      return [];
    });
    return { index: ti, trigger: t.trigger ?? null, prompt: str(t.prompt), steps };
  });
  return {
    format: "tap-trace-v1", session_id: str(doc.session_id), agent: doc.agent_name ?? null,
    agent_version: doc.agent_version ?? null, prompt_version: doc.prompt_version ?? null,
    start_time: doc.start_time ?? null, end_time: doc.end_time ?? null, turns,
  };
}

const textOf = (content: any, type = "text"): string =>
  Array.isArray(content) ? content.filter((c) => c?.type === type).map((c) => str(c[type] ?? c.text)).join("\n") : str(content);

// pi logs are a flat message list: each user message starts a turn.
function fromPi(doc: any, agent: string | null): Session {
  const turns: Turn[] = [];
  const pending = new Map<string, any>(); // toolCallId -> arguments
  let turn: Turn | null = null;
  let n = 0;
  for (const m of doc.messages ?? []) {
    if (m.role === "user" || !turn) {
      turn = { index: turns.length, trigger: m.role === "user" ? "chat" : null, prompt: m.role === "user" ? textOf(m.content) : "", steps: [] };
      turns.push(turn);
      n = 0;
      if (m.role === "user") continue;
    }
    const id = `t${turn.index}.s${n++}`;
    if (m.role === "assistant") {
      const calls = (m.content ?? []).filter((c: any) => c?.type === "toolCall");
      for (const c of calls) pending.set(c.id, c.arguments ?? null);
      turn.steps.push({
        id, kind: "llm", model: m.model ?? null, stop_reason: m.stopReason ?? null,
        text: textOf(m.content), thinking: textOf(m.content, "thinking"),
        tool_calls: calls.map((c: any) => str(c.name)),
        tokens: { input: num(m.usage?.input), output: num(m.usage?.output), cache_read: num(m.usage?.cacheRead), reasoning: num(m.usage?.reasoning) },
        context_used: m.usage ? num(m.usage.input) + num(m.usage.cacheRead) + num(m.usage.output) : null,
        latency_ms: null,
      });
    } else if (m.role === "toolResult") {
      const result = textOf(m.content);
      turn.steps.push({
        id, kind: "tool", name: str(m.toolName), args: pending.get(m.toolCallId) ?? null, result,
        error: m.isError === true || resultIsError(result), latency_ms: null,
      });
    }
  }
  const ts = (doc.messages ?? []).map((m: any) => m.timestamp).filter((t: any) => typeof t === "number");
  const iso = (v: any) => (typeof v === "number" ? new Date(v).toISOString() : typeof v === "string" ? v : null);
  return {
    format: "pi-messages", session_id: str(doc.sessionId), agent, agent_version: null, prompt_version: null,
    start_time: iso(doc.createdAt ?? ts[0]), end_time: iso(doc.updatedAt ?? ts[ts.length - 1]), turns,
  };
}

export type Loaded = { session: Session; bytes: number } | { error: Record<string, unknown> };

export async function loadSession(bucket: string, key: string): Promise<Loaded> {
  if (key.startsWith(SELF_PREFIX)) return { error: { error: "self_session", key, message: "this agent does not analyse its own sessions" } };
  const r = await s3Get(objectUrl(bucket, key));
  if (!r.ok) return { error: s3Error(r, { bucket, key }) };
  let doc: any;
  try {
    doc = JSON.parse(r.text);
  } catch {
    return { error: { error: "not_json", bucket, key } };
  }
  const prefix = key.includes("/") ? key.slice(0, key.indexOf("/")) : null;
  if (doc && Array.isArray(doc.turns) && doc.trace_version !== undefined) return { session: fromTrace(doc), bytes: r.text.length };
  if (doc && Array.isArray(doc.messages)) return { session: fromPi(doc, prefix), bytes: r.text.length };
  return { error: { error: "unknown_format", bucket, key, keys: doc && typeof doc === "object" ? Object.keys(doc).slice(0, 20) : [] } };
}

export const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n) + `… [${s.length - n} more chars]` : s);
