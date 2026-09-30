#!/usr/bin/env bash
# Publish a rendered DocGuard formula to raccioly/homebrew-tap.
#
# Adapted from raccioly/testguard's helper. Idempotent: a tap that already
# carries the exact formula is left alone. Fails closed if the push cannot be
# confirmed. Uses a write deploy key scoped only to the tap repository
# (HOMEBREW_TAP_DEPLOY_KEY); it cannot reach this repository or any other.
#
# @implements docguard.release-readiness#FR-004

set -euo pipefail

fail() {
  echo "::error::$*" >&2
  exit 1
}

VERSION="${1:-}"
FORMULA="${2:-}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "usage: publish-homebrew-tap.sh <stable-semver> <rendered-formula>"
[[ -f "$FORMULA" ]] || fail "rendered formula not found: $FORMULA"

TAP_REMOTE="${HOMEBREW_TAP_REMOTE:-git@github.com:raccioly/homebrew-tap.git}"
FORMULA_VERSION=$(sed -nE 's#^[[:space:]]*url ".*docguard-cli-([0-9]+\.[0-9]+\.[0-9]+)\.tgz"#\1#p' "$FORMULA")
FORMULA_SHA=$(sed -nE 's/^[[:space:]]*sha256 "([0-9a-f]+)"/\1/p' "$FORMULA")
[[ "$FORMULA_VERSION" = "$VERSION" ]] || fail "formula version $FORMULA_VERSION does not match release $VERSION"
[[ "$FORMULA_SHA" =~ ^[0-9a-f]{64}$ ]] || fail "formula sha256 is not 64 lowercase hex characters"

TEMP_ROOT="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
[[ -d "$TEMP_ROOT" ]] || fail "temporary root does not exist: $TEMP_ROOT"
WORK_DIR=$(mktemp -d "$TEMP_ROOT/docguard-homebrew-tap.XXXXXX")

cleanup() {
  case "$WORK_DIR" in
    "$TEMP_ROOT"/docguard-homebrew-tap.*) rm -rf -- "$WORK_DIR" ;;
    *) echo "::warning::refusing to remove unexpected temporary path: $WORK_DIR" >&2 ;;
  esac
}
trap cleanup EXIT

if [[ "$TAP_REMOTE" = git@github.com:* ]]; then
  [[ -n "${HOMEBREW_TAP_DEPLOY_KEY:-}" ]] || fail "HOMEBREW_TAP_DEPLOY_KEY is required for the GitHub tap"
  command -v gh >/dev/null || fail "gh is required to verify GitHub's SSH host keys"
  KEY_FILE="$WORK_DIR/deploy_key"
  KNOWN_HOSTS="$WORK_DIR/known_hosts"
  umask 077
  printf '%s\n' "$HOMEBREW_TAP_DEPLOY_KEY" > "$KEY_FILE"
  gh api meta --jq '.ssh_keys[] | "github.com " + .' > "$KNOWN_HOSTS"
  [[ -s "$KNOWN_HOSTS" ]] || fail "GitHub API returned no SSH host keys"
  export GIT_SSH_COMMAND="ssh -i \"$KEY_FILE\" -o IdentitiesOnly=yes -o UserKnownHostsFile=\"$KNOWN_HOSTS\" -o StrictHostKeyChecking=yes"
fi

TAP_DIR="$WORK_DIR/tap"
git clone --quiet --depth 1 "$TAP_REMOTE" "$TAP_DIR"
TAP_FORMULA="$TAP_DIR/Formula/docguard.rb"
mkdir -p "$TAP_DIR/Formula"

if [[ -f "$TAP_FORMULA" ]] && cmp -s "$FORMULA" "$TAP_FORMULA"; then
  echo "✅ raccioly/tap already carries DocGuard v$VERSION ($FORMULA_SHA)"
  exit 0
fi

install -m 0644 "$FORMULA" "$TAP_FORMULA"
if command -v ruby >/dev/null; then ruby -c "$TAP_FORMULA" >/dev/null; fi
git -C "$TAP_DIR" diff --check
git -C "$TAP_DIR" config user.name "github-actions[bot]"
git -C "$TAP_DIR" config user.email "github-actions[bot]@users.noreply.github.com"
git -C "$TAP_DIR" add Formula/docguard.rb
git -C "$TAP_DIR" commit --quiet -m "docguard $VERSION" -m "Published from raccioly/docguard's release workflow."
git -C "$TAP_DIR" push --quiet origin HEAD:main
git -C "$TAP_DIR" fetch --quiet origin main
cmp "$FORMULA" <(git -C "$TAP_DIR" show origin/main:Formula/docguard.rb) \
  || fail "live tap does not match the rendered formula after push"

echo "✅ published DocGuard v$VERSION to raccioly/tap ($FORMULA_SHA)"
