#!/bin/sh
# Download the pinned tap release (tap.version) into .tap/: tapctl,
# tap-runner and platform.yaml, checked against the release's checksums.
# Used by CI and locally: ./fetch-tap.sh, then .tap/tapctl validate
# --platform .tap/platform.yaml agents/<name>.
set -eu
cd "$(dirname "$0")"
version=$(cat tap.version)
os=$(uname -s | tr '[:upper:]' '[:lower:]')
case $(uname -m) in x86_64|amd64) arch=amd64 ;; arm64|aarch64) arch=arm64 ;; *) echo "unsupported arch $(uname -m)" >&2; exit 1 ;; esac
mkdir -p .tap
if [ -f .tap/version ] && [ "$(cat .tap/version)" = "$version-$os-$arch" ]; then exit 0; fi
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
gh release download "$version" -R ipedrazas/tap -D "$tmp" \
  -p "tapctl-$os-$arch" -p "tap-runner-$os-$arch" -p platform.yaml -p checksums.txt
(cd "$tmp" && grep -E " (tapctl-$os-$arch|tap-runner-$os-$arch|platform.yaml)\$" checksums.txt > want.txt \
  && [ "$(wc -l < want.txt)" -eq 3 ] \
  && { command -v sha256sum >/dev/null && sha256sum -c want.txt || shasum -a 256 -c want.txt; }) >/dev/null \
  || { echo "checksums do not match tap $version" >&2; exit 1; }
install -m 0755 "$tmp/tapctl-$os-$arch" .tap/tapctl
install -m 0755 "$tmp/tap-runner-$os-$arch" .tap/tap-runner
install -m 0644 "$tmp/platform.yaml" .tap/platform.yaml
echo "$version-$os-$arch" > .tap/version
.tap/tapctl --version
