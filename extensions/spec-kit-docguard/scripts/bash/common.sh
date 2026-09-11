#!/usr/bin/env bash
# DocGuard — Shared utilities for bash scripts
# Used by all DocGuard orchestration scripts

set -e

# ── Project Root Detection ─────────────────────────────────────────────────

find_docguard_root() {
    local dir="${1:-$(pwd)}"
    while [ "$dir" != "/" ]; do
        # Check for DocGuard project markers
        if [ -d "$dir/docs-canonical" ] || [ -f "$dir/.docguard.json" ] || [ -f "$dir/CHANGELOG.md" ]; then
            echo "$dir"
            return 0
        fi
        dir="$(dirname "$dir")"
    done
    return 1
}

# ── DocGuard CLI Detection ─────────────────────────────────────────────────

find_docguard_cli() {
    local root="${1:-$(pwd)}"
    local entry
    for entry in "$root/cli/docguard.mjs" "$root/node_modules/docguard-cli/cli/docguard.mjs"; do
        if [ -f "$entry" ] && command -v node >/dev/null 2>&1; then
            printf '%q %q\n' "$(command -v node)" "$entry"
            return 0
        fi
    done
    if command -v docguard >/dev/null 2>&1; then
        printf '%q\n' "$(command -v docguard)"
        return 0
    fi
    return 1
}

# ── JSON Escape ────────────────────────────────────────────────────────────

json_escape() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\t'/\\t}"
    s="${s//$'\r'/\\r}"
    printf '%s' "$s"
}

# ── JSON Output Helper ────────────────────────────────────────────────────

json_output() {
    # Build JSON from key=value pairs
    # Usage: json_output key1 "value1" key2 "value2"
    local result="{"
    local first=true
    while [ $# -ge 2 ]; do
        if [ "$first" = true ]; then
            first=false
        else
            result="$result,"
        fi
        result="$result\"$1\":\"$(json_escape "$2")\""
        shift 2
    done
    result="$result}"
    echo "$result"
}

# ── Date Helpers ───────────────────────────────────────────────────────────

today_iso() {
    date +%Y-%m-%d
}

# ── File Helpers ───────────────────────────────────────────────────────────

file_exists() {
    [ -f "$1" ]
}

dir_exists() {
    [ -d "$1" ]
}

ensure_dir() {
    mkdir -p "$1"
}

# ── Metadata Helpers ──────────────────────────────────────────────────────

extract_metadata() {
    local file="$1"
    local key="$2"
    grep "docguard:${key}" "$file" 2>/dev/null | sed "s/.*docguard:${key} //" | sed 's/ -->//' | tr -d '\r'
}
