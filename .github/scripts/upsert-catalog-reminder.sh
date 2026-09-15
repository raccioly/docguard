#!/usr/bin/env bash

set -euo pipefail

VERSION="${1:?usage: upsert-catalog-reminder.sh <version> <body-file>}"
BODY_FILE="${2:?usage: upsert-catalog-reminder.sh <version> <body-file>}"
REPOSITORY="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
TITLE="📦 Submit DocGuard v${VERSION} to the spec-kit community catalog"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Invalid release version: $VERSION" >&2
  exit 1
fi
if [[ ! -f "$BODY_FILE" ]]; then
  echo "Reminder body does not exist: $BODY_FILE" >&2
  exit 1
fi

reminders=$(
  gh issue list \
    --repo "$REPOSITORY" \
    --state open \
    --limit 100 \
    --json number,title \
    --jq '.[] | select(.title | startswith("📦 Submit DocGuard v") and endswith(" to the spec-kit community catalog")) | .number' \
    | sort -n
)

if [[ -z "$reminders" ]]; then
  gh issue create --repo "$REPOSITORY" --title "$TITLE" --body-file "$BODY_FILE"
  echo "✅ Opened catalog-submission reminder issue"
  exit 0
fi

current=$(printf '%s\n' "$reminders" | tail -n 1)
gh issue edit "$current" --repo "$REPOSITORY" --title "$TITLE" --body-file "$BODY_FILE"
echo "✅ Refreshed reminder issue #${current}"

while IFS= read -r duplicate; do
  if [[ -z "$duplicate" ]]; then
    continue
  fi
  if [[ "$duplicate" == "$current" ]]; then
    continue
  fi
  gh issue close "$duplicate" \
    --repo "$REPOSITORY" \
    --comment "Superseded by the current catalog reminder #${current}."
  echo "✅ Closed superseded reminder issue #${duplicate}"
done <<< "$reminders"
