# tap-agents

The agents that run on [tap](https://github.com/ipedrazas/tap), one directory per agent under `agents/<name>/`. tap's docs explain bundles, signing and the GitOps plan this repo is part of.

`tap.version` pins the tap release used to validate, test and (later) build and render these agents. That release's `platform.yaml` decides which runner images agents may use, so bumping the pin is a PR that retests every agent.

```bash
./fetch-tap.sh        # tapctl, tap-runner and platform.yaml for tap.version, into .tap/ (needs gh)
.tap/tapctl validate --platform .tap/platform.yaml agents/<name>
.tap/tapctl diff --platform .tap/platform.yaml --base git:origin/main agents/<name>
```

CI (`.github/workflows/ci.yml`) validates every agent, prints the permission diff against the base branch (a widening needs human review), and runs the fixtures with the same Node and Python versions as tap's runner images. It has no cluster, registry or signing credentials.
