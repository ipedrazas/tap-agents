# Acceptance criteria (`acceptance.yaml`, enforced by `tapctl validate`, rule 13)

`acceptance.yaml` says what a good answer from the agent looks like. It's optional. The harness verifies every answer against it, outside the agent's conversation:
1. deterministic checks run first, in the runner;
2. judged criteria run next, each once the checks it `uses` have passed (a failure in a check it doesn't use doesn't stop it, so one attempt reports every problem);
3. human criteria flag a sample of answers for review in the console.

If a blocking criterion fails, the agent gets the reasons and answers again, up to `maxAttempts`; after that the answer is marked failed. The full reference is `docs/acceptance.md` in the tap repo; `agents/deep-research-agent` is the worked example.

## Where criteria come from

People can't list their requirements up front, but they recognise a bad answer when they see one. So **never ask the user to define validation criteria from scratch.** Do this instead:

1. **Draft** a small spec from the brief: the output format the system prompt asks for, and the examples' "what the answer contains". Two to four criteria is plenty.
2. **Show real outputs.** Ask for two or three inputs the user would really give the agent. Run them, show the answers, and ask what's wrong with each, in their own words. To run them: `task agent:preview AGENT=<name>` (only when the user agrees; remove it afterwards) and chat with `<name>-dev`. If that isn't possible, walk through what the agent would answer, step by step, from the tools' fixtures.
3. **Turn each reaction into one criterion.** For "this source is spam", "too shallow on X", "it cited a page that says the opposite":
   - find the rule behind the reaction;
   - make it **deterministic** if it can be stated: a domain blocklist, at least N sources per section, a required section, a number in range;
   - make it **judged** only if it needs reading comprehension;
   - watch for a rule that is a judgement in disguise (below);
   - add the output that prompted it as a failing fixture case.
4. **Show each proposed criterion** (id, description, kind, and the script or rubric) and write it to the spec only after the user approves or edits it.

Later reactions arrive the same way: the console's review queue records each person's verdict and note per answer (`task verify:pull` in the tap repo). Each note is a candidate criterion.

## Agents that act

Verification runs **after** the turn. Tools with `write` or `irreversible` effects under `effectsPolicy: auto` run **during** it, so by the time a check fails, the PR is open or the comment is posted. A retry can't undo that, and a careless one does it twice. `tapctl validate` prints a note for these agents but doesn't refuse them. Explain the limitation to the user, then help them pick one of these:

- **Check the effect, not the intent.** If the job is to open a PR, the criterion is "the PR exists, targets the right branch and contains the change". A deterministic check can confirm that with read access.
- **Make actions idempotent.** Find and update an existing PR or comment, use a stable branch name. Then a retry fixes the result instead of duplicating it.
- **Split the draft from the action** when the stakes are high. The agent's answer is the draft and the criteria check it; a later step, a person or another hook, performs the action.
- **`maxAttempts: 1`** for actions that must never repeat. Failures are still recorded and queued for review.

## The file

```yaml
apiVersion: tavon.ai/acceptance/v1
kind: Acceptance
maxAttempts: 2           # attempts in all, the first included (1-5)
verifyOn: [chat, hook]   # default both; [hook] for agents people chat with casually
verifier:
  model: default         # a gateway route other than the agent's, so the judge isn't the author
criteria:
  - id: claims-cited     # ^[a-z][a-z0-9-]{1,46}[a-z0-9]$, unique
    description: Every factual statement cites a listed source.
    kind: deterministic
    exec: ["node", "checks/claims_cited.ts"]   # a script under checks/; no {{templates}}
    timeout: 5s
    egress: ["*:443"]    # optional; host:port, or *:443 for any public host
    secrets: []          # optional; names declared in agent.yaml secrets
    # blocking: false    # report only
  - id: answers-question
    description: The report addresses every part of the question.
    kind: judged
    rubricFile: acceptance/answers-question.md # or rubric: inline text
    threshold: 0.7                             # pass when score >= threshold
    uses: [claims-cited]                       # optional: these checks' evidence goes to the judge
  - id: human-sample
    description: A person reads one answer in five.
    kind: human
    sampleRate: 0.2
```

### A judgement in disguise

Some rules sound syntactic but aren't. "Every claim is cited" turns into "every sentence has a citation" once a script enforces it, and a report is not only claims: lead-ins ("Two further points matter."), transitions and the report's own reasoning state nothing a source could back. A check that guesses from punctuation flags them, the agent gets told to fix a sentence that was fine, and each prompt tweak only moves the next false failure. deep-research-agent hit exactly this (0.1.3).

Split such a rule along the line a script can draw:
- **deterministic:** what the format decides (every `[n]` is listed, every source is cited) plus any high-precision signal (a sentence with a figure is always a claim);
- **judged:** the rest (which sentences are claims, and whether each is supported), with the rubric saying what is *not* a claim.

## Deterministic checks

- **The contract.** A check reads `{"task": "...", "output": "...", "attempt": 1}` on **stdin** and prints one object on stdout: `{"pass": bool, "reason": "...", "details"?: ..., "evidence"?: ...}`. It exits 0 either way. A crash, a timeout or other output is an `error`, which counts as a failure.
- **`reason`** goes to the agent, so make it specific enough to fix: "1 of 4 statements has no citation", not "bad".
- **`details`** lists the specifics; keep it short (at most 16 KiB).
- **`evidence`** (for example, the fetched page text) goes to judged criteria that `use` the check.
- **Writing output.** In Node, `process.stdout.write` then `process.exit` can lose output on a pipe. Use the synchronous `writeSync(1, …)` loop from `agents/deep-research-agent/checks/report.ts`.
- **Isolation.** Checks run like tools: their own uid, a clean environment, their own egress and secrets, stdlib only, and an interpreter that is in the agent's runner image. Shared code can live in `tools/`, which the runner mounts too (`import … from "../tools/page.ts"`).
- **Fixtures are required, at least one passing and one failing case per check,** in `tests/checks/<id>.check.yaml`. A check never seen to fail catches nothing. Recorded HTTP works as for tools.

```yaml
check: links-resolve
cases:
  - name: a soft 404 is caught
    task: q
    output: |
      ...
    http:
      - { method: GET, url: "https://stats.example.org/x", status: 200, headers: { content-type: text/html }, body: "<title>Page not found</title>" }
    expect: { pass: false, reason: "soft 404" }   # reason: a Go regular expression
```

## Judged criteria

Write the rubric for a careful reviewer who has only the task, the answer and any evidence:
- say what counts and what doesn't;
- define the score, usually "good items / all items";
- ask the reason to name what to fix, because the agent gets that reason back.

Put long rubrics in `acceptance/<id>.md`. The agent never sees rubrics, and the answer is untrusted input to the judge: don't write rubrics that ask the judge to follow instructions found in the answer.
