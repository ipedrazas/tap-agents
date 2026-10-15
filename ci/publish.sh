#!/bin/sh
# Render every agent's manifests for its tested bundle and push them as one
# signed OCI artifact, registry/tap/agents-manifests:<commit> tagged main,
# which Flux applies after verifying the signature (tap's gitops plan,
# phase 5). Fails if any agent's bundle isn't signed as built and tested.
. ci/lib.sh
pubkeys
out=.tap/manifests
rm -rf "$out"; mkdir -p "$out"
for dir in agents/*/; do
  a=$(basename "$dir")
  ref=$(digest_ref "$a")
  verified "$ref" .tap/cosign.pub && verified "$ref" .tap/cosign-tested.pub \
    || { echo "::error::$a: $ref is not signed as built and tested"; exit 1; }
  "$TAPCTL" render --platform "$PLATFORM" --bundle "$ref" "agents/$a" > "$out/$a.yaml"
  echo "- $a: \`$ref\`" >> "$GITHUB_STEP_SUMMARY"
done
repo="$REGISTRY/tap/agents-manifests"
digest=$(flux push artifact "oci://$repo:$GITHUB_SHA" --path="$out" \
  --source="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY" --revision="main@sha1:$GITHUB_SHA" \
  --annotations="tap.hiddenfield.dev/tap-version=$(cat tap.version)" --output json | jq -r .digest)
case "$digest" in sha256:*) ;; *) echo "::error::flux push artifact gave no digest"; exit 1;; esac
sign_once "$repo@$digest" tap-build
flux tag artifact "oci://$repo:$GITHUB_SHA" --tag main
echo "### manifests: \`$repo@$digest\` (tags $GITHUB_SHA, main)" >> "$GITHUB_STEP_SUMMARY"
