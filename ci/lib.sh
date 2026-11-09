# Sourced by the publish workflow's steps. Credentials come from OpenBao,
# which trusts GitHub's OIDC token (auth/jwt-github, set up by tap's
# `task ci:onboard`): nothing is stored in GitHub.
#
# Env: VAULT_ADDR, REGISTRY; ACTIONS_ID_TOKEN_REQUEST_{URL,TOKEN} (id-token: write).
set -eu

TAPCTL=".tap/tapctl"
PLATFORM=".tap/platform.yaml"

# bao_login <role>: exchange the job's OIDC token for an OpenBao token and
# export it (masked) to this and later steps as VAULT_TOKEN.
bao_login() {
  jwt=$(curl -sSf -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=openbao" | jq -r .value)
  VAULT_TOKEN=$(jq -n --arg role "$1" --arg jwt "$jwt" '{role: $role, jwt: $jwt}' \
    | curl -sSf -X POST --data @- "$VAULT_ADDR/v1/auth/jwt-github/login" | jq -r .auth.client_token)
  [ -n "$VAULT_TOKEN" ] && [ "$VAULT_TOKEN" != null ] || { echo "::error::OpenBao login as $1 failed"; return 1; }
  echo "::add-mask::$VAULT_TOKEN"
  export VAULT_TOKEN
  [ -z "${GITHUB_ENV:-}" ] || echo "VAULT_TOKEN=$VAULT_TOKEN" >> "$GITHUB_ENV"
}

bao_get() { # <path under secret/> <field>
  curl -sSf -H "X-Vault-Token: $VAULT_TOKEN" "$VAULT_ADDR/v1/secret/data/$1" | jq -r ".data.data[\"$2\"]"
}

# retry <attempts> <command...>: run the command until it succeeds, waiting
# 5, 10, 20, ... seconds between attempts. For calls over the tailnet, where
# a fresh runner's path to the LAN can drop for a few seconds.
retry() {
  n=$1; shift
  i=1
  until "$@"; do
    [ "$i" -ge "$n" ] && { echo "::error::$1 failed $n times"; return 1; }
    wait=$((5 << (i - 1)))
    echo "::warning::$1 failed (attempt $i of $n); retrying in ${wait}s"
    sleep "$wait"
    i=$((i + 1))
  done
}

# registry_login: the tap-ci push user, for tapctl, cosign and flux (all
# read the Docker config). Retried: a login that timed out reaching the
# registry failed a whole publish run (2026-11-09) while the next job got in.
registry_login() {
  pw=$(bao_get tap-ci/zot password)
  echo "::add-mask::$pw"
  user=$(bao_get tap-ci/zot username)
  retry 5 docker_login "$user" "$pw"
}

docker_login() { # <user> <password>
  printf '%s' "$2" | docker login "$REGISTRY" -u "$1" --password-stdin >/dev/null
}

# kube_login: a 30-minute token for tap-ci/tap-ci-runner, minted by OpenBao.
kube_login() {
  tok=$(curl -sSf -X POST -H "X-Vault-Token: $VAULT_TOKEN" --data '{"kubernetes_namespace":"tap-ci","ttl":"30m"}' \
    "$VAULT_ADDR/v1/tap-kubernetes/creds/tap-ci-runner" | jq -r .data.service_account_token)
  echo "::add-mask::$tok"
  export KUBECONFIG="$RUNNER_TEMP/kubeconfig"
  bao_get tap-ci/kube ca > "$RUNNER_TEMP/kube-ca.crt"
  kubectl config set-cluster tap --server="$(bao_get tap-ci/kube server)" --certificate-authority="$RUNNER_TEMP/kube-ca.crt" --embed-certs >/dev/null
  kubectl config set-credentials tap-ci-runner --token="$tok" >/dev/null
  kubectl config set-context tap --cluster=tap --user=tap-ci-runner --namespace=tap-ci >/dev/null
  kubectl config use-context tap >/dev/null
  [ -z "${GITHUB_ENV:-}" ] || echo "KUBECONFIG=$KUBECONFIG" >> "$GITHUB_ENV"
}

# digest_ref <agent>: the bundle the sources build to (reproducible, no push).
digest_ref() { "$TAPCTL" bundle build --platform "$PLATFORM" "agents/$1"; }

pubkeys() {
  "$TAPCTL" signing key --platform "$PLATFORM" build > .tap/cosign.pub
  "$TAPCTL" signing key --platform "$PLATFORM" tested > .tap/cosign-tested.pub
}

verified() { # <ref> <pubkey file>
  cosign verify --key "$2" --insecure-ignore-tlog=true "$1" >/dev/null 2>&1
}

# sign_once <ref> <transit key> [cosign sign args]: ECDSA signatures differ
# every time, so sign only when no valid one exists.
sign_once() {
  ref=$1 key=$2; shift 2
  pub=.tap/cosign.pub; [ "$key" = tap-tested ] && pub=.tap/cosign-tested.pub
  verified "$ref" "$pub" && { echo "already signed with $key: $ref"; return 0; }
  cosign sign --key "hashivault://$key" --tlog-upload=false --yes "$@" "$ref" 2>&1 | grep -v '^WARNING' || true
  verified "$ref" "$pub" || { echo "::error::signing $ref with $key failed"; return 1; }
  echo "signed with $key: $ref"
}
