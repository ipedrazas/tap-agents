#!/bin/sh
# Wait until Flux has applied this commit's manifests (tap's deploy/flux/agents.yaml:
# Kustomization flux-system/agents) and everything it applied is ready. The
# artifact carries its origin, main@sha1:<commit>, so the Kustomization's
# lastAppliedOriginRevision says which commit is live.
. ci/lib.sh
want="main@sha1:$GITHUB_SHA"
# Fetch now rather than at the source's next one-minute interval.
kubectl -n flux-system annotate ocirepository agents "reconcile.fluxcd.io/requestedAt=$(date +%s)" --overwrite >/dev/null
for i in $(seq 1 60); do
  got=$(kubectl -n flux-system get kustomization agents -o jsonpath='{.status.lastAppliedOriginRevision}')
  ready=$(kubectl -n flux-system get kustomization agents -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}')
  msg=$(kubectl -n flux-system get kustomization agents -o jsonpath='{.status.conditions[?(@.type=="Ready")].message}')
  if [ "$got" = "$want" ] && [ "$ready" = True ]; then
    echo "applied and ready: $want"
    echo "### deployed: \`$want\`" >> "$GITHUB_STEP_SUMMARY"
    exit 0
  fi
  echo "waiting: applied ${got:-nothing} (ready: ${ready:-?}) ${msg}"
  sleep 10
done
echo "::error::Flux did not apply $want within 10 minutes: ${msg}"
exit 1
