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

Merging to main deploys:
1. `.github/workflows/publish.yml` builds, pushes and signs the bundles whose sources changed (bump `metadata.version`).
2. It runs their fixtures in the cluster, then attests and signs them as tested.
3. It publishes every agent's manifests as one signed artifact.
4. Flux applies the artifact, and the commit gets a `tap/deploy` status.

Store an agent's secrets before merging (`task secrets:put`). Reverting a commit rolls it back.

To try a PR in the cluster before merging, check out its branch and run `task agent:preview AGENT=<name>`. This runs the fixtures in `tap-ci`, then deploys `<name>-dev` at `https://<name>-dev.a.hiddenfield.dev`, in its own namespace, with its own secrets (`secrets:put ... PREVIEW=1`), egress key and allowlist. Admission accepts its bundle signed as built; only CI signs as tested. Remove it with `task agent:preview:rm AGENT=<name>`.

Tasks that need the cluster, the registry or OpenBao (`agent:test`, `agent:verify`, `secrets:put`) run in a tap checkout at `TAP_DIR` (default `../tap`). `agent:deploy`, `agent:dev` and `agent:launch` refuse agents that Flux manages.

CI (`.github/workflows/ci.yml`) validates every agent, prints the permission diff against the base branch (a widening needs human review), and runs the fixtures with the same Node and Python versions as tap's runner images. It has no cluster, registry or signing credentials.
