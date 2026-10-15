#!/bin/sh
# Print agents=<JSON list> of agents whose sources build to a digest that has
# no tested signature yet. Bundles are reproducible, so this is the change
# detection: unchanged agents rebuild to digests that are already signed.
. ci/lib.sh
pubkeys
todo=""
for dir in agents/*/; do
  a=$(basename "$dir")
  ref=$(digest_ref "$a")
  if verified "$ref" .tap/cosign-tested.pub; then
    echo "tested already: $ref" >&2
  else
    echo "needs build and test: $ref" >&2
    todo="$todo $a"
  fi
done
printf 'agents=%s\n' "$(printf '%s\n' $todo | jq -R . | jq -cs 'map(select(. != ""))')"
