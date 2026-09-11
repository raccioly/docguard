#!/usr/bin/env bash
# DocGuard — Check project documentation status
# Returns JSON with document inventory and health status
#
# Usage:
#   ./docguard-check-docs.sh [--json] [--verbose]
#
# JSON output fields:
#   PROJECT_ROOT  — absolute path to project root
#   CLI_CMD       — command to run DocGuard CLI
#   DOCS          — array of {name, path, exists, version, status, lastReviewed}
#   SCORE         — CDD maturity score (if --verbose)
#   GUARD_PASS    — number of passing guard checks (if --verbose)
#   GUARD_TOTAL   — total guard checks (if --verbose)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

JSON_MODE=false
VERBOSE=false

while [ $# -gt 0 ]; do
    case "$1" in
        --json) JSON_MODE=true ;;
        --verbose) VERBOSE=true ;;
        --help|-h)
            echo "Usage: $0 [--json] [--verbose]"
            echo ""
            echo "Options:"
            echo "  --json     Output in JSON format for AI consumption"
            echo "  --verbose  Include score and guard results"
            echo "  --help     Show this help message"
            exit 0
            ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
    shift
done

# Find project root
PROJECT_ROOT=$(find_docguard_root "$(pwd)") || {
    echo "Error: No DocGuard project found. Run 'docguard init' first." >&2
    exit 1
}

# Find CLI command
CLI_CMD=$(find_docguard_cli "$PROJECT_ROOT") || {
    echo "Error: DocGuard CLI not found. Install with: npm i -g docguard-cli" >&2
    exit 1
}

cd "$PROJECT_ROOT"

# Canonical documents to check
CANONICAL_DOCS=(
    "docs-canonical/ARCHITECTURE.md"
    "docs-canonical/DATA-MODEL.md"
    "docs-canonical/SECURITY.md"
    "docs-canonical/TEST-SPEC.md"
    "docs-canonical/ENVIRONMENT.md"
    "docs-canonical/REQUIREMENTS.md"
)

# Support documents
SUPPORT_DOCS=(
    "CHANGELOG.md"
    "DRIFT-LOG.md"
    "AGENTS.md"
    "README.md"
    "ROADMAP.md"
)

if $JSON_MODE; then
    # Build canonical docs JSON array
    DOCS_JSON="["
    first=true
    for doc in "${CANONICAL_DOCS[@]}" "${SUPPORT_DOCS[@]}"; do
        if [ "$first" = true ]; then first=false; else DOCS_JSON="$DOCS_JSON,"; fi
        
        doc_name=$(basename "$doc" .md)
        doc_path="$PROJECT_ROOT/$doc"
        doc_exists="false"
        doc_version=""
        doc_status=""
        doc_reviewed=""
        
        if [ -f "$doc_path" ]; then
            doc_exists="true"
            doc_version=$(extract_metadata "$doc_path" "version" 2>/dev/null || echo "")
            doc_status=$(extract_metadata "$doc_path" "status" 2>/dev/null || echo "")
            doc_reviewed=$(extract_metadata "$doc_path" "last-reviewed" 2>/dev/null || echo "")
        fi
        
        DOCS_JSON="$DOCS_JSON{\"name\":\"$(json_escape "$doc_name")\",\"path\":\"$(json_escape "$doc")\",\"exists\":$doc_exists"
        [ -n "$doc_version" ] && DOCS_JSON="$DOCS_JSON,\"version\":\"$(json_escape "$doc_version")\""
        [ -n "$doc_status" ] && DOCS_JSON="$DOCS_JSON,\"status\":\"$(json_escape "$doc_status")\""
        [ -n "$doc_reviewed" ] && DOCS_JSON="$DOCS_JSON,\"lastReviewed\":\"$(json_escape "$doc_reviewed")\""
        DOCS_JSON="$DOCS_JSON}"
    done
    DOCS_JSON="$DOCS_JSON]"
    
    # Optionally include score and guard
    EXTRAS=""
    if $VERBOSE; then
        SCORE_OUTPUT=$(eval "$CLI_CMD score --format json")
        SCORE=$(printf '%s' "$SCORE_OUTPUT" | node -e '
          const d=JSON.parse(require("fs").readFileSync(0,"utf8"));
          if(!Number.isFinite(d.score) || d.score<0 || d.score>100) throw Error("Invalid DocGuard score");
          process.stdout.write(String(d.score));
        ')
        GUARD_STATUS=0
        GUARD_OUTPUT=$(eval "$CLI_CMD guard --format json") || GUARD_STATUS=$?
        EXTRAS=$(printf '%s' "$GUARD_OUTPUT" | node -e '
          const d=JSON.parse(require("fs").readFileSync(0,"utf8"));
          const exit=Number(process.argv[2]);
          const expected={PASS:0,WARN:2,FAIL:1};
          if(!Object.hasOwn(expected,d.status) || expected[d.status]!==exit ||
             !Number.isInteger(d.passed) || !Number.isInteger(d.total) ||
             d.passed<0 || d.total<d.passed) throw Error("Invalid DocGuard guard report");
          const fields={score:Number(process.argv[1]),guardPass:d.passed,guardTotal:d.total,guardStatus:d.status};
          process.stdout.write(","+JSON.stringify(fields).slice(1,-1));
        ' "$SCORE" "$GUARD_STATUS")
    fi
    
    # Check for spec-kit
    HAS_SPECKIT="false"
    [ -d "$PROJECT_ROOT/.specify" ] && HAS_SPECKIT="true"
    
    echo "{\"projectRoot\":\"$(json_escape "$PROJECT_ROOT")\",\"cliCommand\":\"$(json_escape "$CLI_CMD")\",\"hasSpecKit\":$HAS_SPECKIT,\"docs\":$DOCS_JSON$EXTRAS}"
else
    echo "DocGuard Project: $PROJECT_ROOT"
    echo "CLI: $CLI_CMD"
    echo ""
    echo "Canonical Documents:"
    for doc in "${CANONICAL_DOCS[@]}"; do
        if [ -f "$PROJECT_ROOT/$doc" ]; then
            version=$(extract_metadata "$PROJECT_ROOT/$doc" "version" 2>/dev/null || echo "?")
            reviewed=$(extract_metadata "$PROJECT_ROOT/$doc" "last-reviewed" 2>/dev/null || echo "?")
            echo "  ✅ $doc (v$version, reviewed: $reviewed)"
        else
            echo "  ❌ $doc (MISSING)"
        fi
    done
    echo ""
    echo "Support Documents:"
    for doc in "${SUPPORT_DOCS[@]}"; do
        if [ -f "$PROJECT_ROOT/$doc" ]; then
            echo "  ✅ $doc"
        else
            echo "  ❌ $doc (MISSING)"
        fi
    done
    
    if $VERBOSE; then
        echo ""
        eval $CLI_CMD score 2>&1 || true
    fi
fi
