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
# Note: DocGuard has zero production dependencies, but we run npm install
# in case devDependencies are added in the future.
npm install

# ------------------------------------------
# 3. Ecosystem-Specific Tests & Build Checks
# ------------------------------------------
echo "🧪 === Running Initial Test & Validation ==="
# Execute the native Node.js tests
npm test || echo "⚠️ Tests failed, but continuing..."

echo "🏗️ === Verifying Build Integrity ==="
# Test the primary CLI entrypoint to ensure it is executable
node cli/docguard.mjs --version

echo "🧹 === Enforcing Git Tree Integrity ==="
# Jules requires the working directory to be clean after this script runs
git clean -fd || true

echo "✅ Jules VM Local Environment is Ready!"
