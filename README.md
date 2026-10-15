# tap-agents

The agents that run on [tap](https://github.com/ipedrazas/tap), one directory per agent under `agents/<name>/`. tap's docs explain bundles, signing and the GitOps plan this repo is part of.

`tap.version` pins the tap release used to validate, test and (later) build and render these agents. That release's `platform.yaml` decides which runner images agents may use, so bumping the pin is a PR that retests every agent.

```bash
task agent:new NAME=demo-agent RUNNER=runner-python DESCRIPTION="..."
task agent:validate AGENT=demo-agent
task agent:test:local AGENT=demo-agent    # host interpreters (real paths, not mise shims)
task agent:diff AGENT=demo-agent          # exit 3: permissions widened, needs review
```

The first task downloads the pinned release into `.tap/` (`./fetch-tap.sh`, needs `gh`). Writing agents: `.claude/skills/new-agent/SKILL.md`. Each agent that the factory is evaluated against has its spec in `agents/<name>/eval.md`; `eval.md` isn't part of the bundle.

Tasks that need the cluster, the registry or OpenBao (`agent:test`, `agent:verify`, `agent:deploy`, `agent:dev`, `agent:launch`, `secrets:put`) run in a tap checkout at `TAP_DIR` (default `../tap`) on this repo's agents. CI and Flux take them over in phases 4 and 5 of tap's `docs/gitops-plan.md`.

CI (`.github/workflows/ci.yml`) validates every agent, prints the permission diff against the base branch (a widening needs human review), and runs the fixtures with the same Node and Python versions as tap's runner images. It has no cluster, registry or signing credentials.
