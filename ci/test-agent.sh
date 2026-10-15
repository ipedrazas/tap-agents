#!/bin/sh
# test-agent.sh <agent> [<base>]: run the bundle's fixtures in its real runner
# image under gVisor (a Job in tap-ci), then attest the passing run and sign
# the bundle as tested. Same steps as tap's `task agent:test` / agent:attest,
# with credentials from OpenBao (role tap-ci-tested, environment "tested").
. ci/lib.sh
a=$1 base=${2:-} # empty: a new agent
pubkeys
ref=$(digest_ref "$a")
verified "$ref" .tap/cosign.pub || { echo "::error::$ref has no build signature; the build job signs it first"; exit 1; }
printf '%s\n' "$ref" > ".tap/$a.digest"

# The Job only: tap-ci and its NetworkPolicy exist, and tap-ci-runner may only
# manage Jobs there.
"$TAPCTL" render --platform "$PLATFORM" --test --bundle "$ref" "agents/$a" \
  | yq 'select(.kind == "Job")' > ".tap/$a.job.yaml"
job=$(yq -r .metadata.name ".tap/$a.job.yaml")
[ -n "$job" ] || { echo "::error::no Job in the rendered test manifests"; exit 1; }
kubectl apply -f ".tap/$a.job.yaml" >/dev/null
echo "job tap-ci/$job"
status=""
for i in $(seq 1 150); do
  status=$(kubectl get job "$job" -o jsonpath='{.status.conditions[?(@.status=="True")].type}')
  case "$status" in *Complete*|*Failed*) break;; esac
  sleep 4
done
kubectl logs "job/$job" -c fixtures > ".tap/$a.test.log" 2>/dev/null || true
grep -vE '^\{"time"' ".tap/$a.test.log" || true
case "$status" in
  *Complete*) ;;
  *) echo "::error::$a: fixtures did not pass (status: ${status:-timeout})"; exit 1;;
esac

git config user.email "github-actions@$GITHUB_REPOSITORY"
git config user.name "$GITHUB_WORKFLOW #$GITHUB_RUN_NUMBER"
"$TAPCTL" attest --platform "$PLATFORM" --bundle-file ".tap/$a.digest" --test-log ".tap/$a.test.log" \
  --environment "cluster:tap-ci/$job" --base "$base" "agents/$a" > ".tap/$a.predicate.json"
cosign attest --key hashivault://tap-build --tlog-upload=false --yes \
  --type "$(yq -r .signing.predicateType "$PLATFORM")" --predicate ".tap/$a.predicate.json" "$ref" 2>&1 | grep -v '^WARNING' || true
sign_once "$ref" tap-tested -a "tap.hiddenfield.dev/attestation=sha256:$(sha256sum ".tap/$a.predicate.json" | cut -d' ' -f1)"
echo "### $a: tested and signed" >> "$GITHUB_STEP_SUMMARY"
echo "\`$ref\`" >> "$GITHUB_STEP_SUMMARY"
