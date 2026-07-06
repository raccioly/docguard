#!/bin/bash
# ==========================================
# Google Jules Environment Startup Script
# ==========================================
# Use this configuration in the Jules Dashboard:
# Repo -> Configuration -> Initial Setup

set -e

# ------------------------------------------
# 1. Inject Headless Dummy Credentials
# ------------------------------------------
# Mocking AI provider keys in case tests or agent integrations require them
export GEMINI_API_KEY="dummy-jules-key"
export ANTHROPIC_API_KEY="dummy-anthropic-key"
export OPENAI_API_KEY="dummy-openai-key"

# ------------------------------------------
# 2. Ecosystem-Specific Dependency Installation
# ------------------------------------------
echo "📦 === Installing Dependencies ==="
# DocGuard has one exact-pinned runtime dep (@babel/parser). Use `npm ci`, NOT
# `npm install`: `npm ci` installs strictly from package-lock.json and never
# rewrites it, so it leaves the working tree clean. `npm install` can re-resolve
# and rewrite package-lock.json, which dirties the tree and makes Jules abort
# with "Working tree is dirty" after setup.
npm ci

# ------------------------------------------
# 3. Ecosystem-Specific Tests & Build Checks
# ------------------------------------------
echo "🧪 === Running Initial Test & Validation ==="
# Execute the native Node.js tests
npm test || echo "⚠️ Tests failed, but continuing..."

echo "🏗️ === Verifying Build Integrity ==="
# Test the primary CLI entrypoint to ensure it is executable.
# Note: `--version` triggers ensureSkills, which regenerates the tracked
# `.agent/skills/*.md` files (their `version:` frontmatter tracks the release),
# so the tree is expected to be dirty right after this — the reset below
# discards that regeneration.
node cli/docguard.mjs --version

echo "🧹 === Enforcing Git Tree Integrity ==="
# Jules requires the working directory to be clean after this script runs, and
# ignores any changes setup makes. `git clean -fd` alone is INSUFFICIENT — it
# only removes UNTRACKED files, but our churn is in TRACKED files (regenerated
# .agent/skills). Hard-reset discards tracked modifications; clean -fd sweeps
# any stray untracked files. `-fd` respects .gitignore, so node_modules (which
# we just installed) is preserved.
git reset --hard HEAD
git clean -fd || true

echo "✅ Jules VM Local Environment is Ready!"
