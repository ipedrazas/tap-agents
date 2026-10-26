---
name: session-analyser
description: What session-analyser-agent's tools return and what each summary signal means
---

# session-analyser

The three tools read session objects from the Tigris sessions bucket (`t3.storage.dev`, default bucket `hiddenfield-tap-sessions`) with a read-only key. Objects live at `<agent>/<session id>.trace.json` (tap traces) or `<agent>/<id>.json` (pi logs). Expected failures come back as JSON with an `error` field: `not_found`, `forbidden`, `upstream`, `not_json`, `unknown_format`, `self_session` (this agent's own prefix), `no_such_turn`.

## Formats

Both are normalised to turns of steps:

- `tap-trace-v1`: casa trace documents written by tap's harness. Has `agent_version` and `prompt_version`, a `trigger` per turn (`hook` = a webhook started it and nobody is there to answer; `chat` = a person), and per-step latency.
- `pi-messages`: pi agent logs. A turn is one user message and everything until the next. No versions, no latency (`null`); `agent` is the key's prefix.

Step ids are `t<turn>.s<position>`: `t0.s7` is turn 0, position 7, which is `get_session_steps(turn: 0, from: 7)`.

## get_session_summary

- `totals`: turns, llm_calls, tool_calls, tool_errors, summed `tokens` (`cache_read` is context served from the provider's cache), `max_context_used` (largest prompt the model saw).
- `tools`: per tool name, `calls`, `errors`, `max_latency_ms`, `max_result_chars`. `read_skill_file` is the harness reading a skill, not a declared tool.
- `turns[]` (first 30): `trigger`, `prompt` (clipped), `tool_calls` (count per tool), `tool_errors`, `final_answer` (last non-empty model text, clipped) and its `final_step`.
- `signals[]`, leads to check:
  - `tool_error`: calls whose result was an error (runner failure, `{"error": ...}`, or text starting `Error`), grouped per tool with the first message. Read the message: it often says how to recover; check whether the agent did.
  - `repeated_call`: the same tool with identical arguments more than once. Fine after a transient failure; a finding when the result can't have changed.
  - `heavy_tool_use`: one tool called 15+ times in a turn. Ask whether a different tool, a wider window or less reading would do.
  - `large_result`: a single result over 40,000 characters, which inflates every later call's context.
  - `high_context`: the model's context passed 100k tokens.
  - `slow_llm_call`: a model call over 60 s; see its output and reasoning tokens.
  - `unfinished_turn`: the turn didn't end with a model answer (`stop`), e.g. it ran out of turns or crashed mid-tool.

## get_session_steps

`steps[]` for one turn, from `from`, at most `count`, each field clipped to `max_chars` (clipping is marked `… [N more chars]`):

- tool steps: `name`, `args` (JSON text), `result`, `error`, `latency_ms`;
- llm steps: `model`, `stop_reason` (`tool_calls`/`toolUse` = it asked for tools; `stop` = it answered), `tool_calls` (names it asked for, answered by the following tool steps), `tokens`, `context_used`, `text`, `thinking` (pi logs only).

`next_from` is the next position, or `null` at the end of the turn.
