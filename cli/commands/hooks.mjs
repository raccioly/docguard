/**
 * Hooks Command — Generate pre-commit/pre-push hooks for DocGuard
 * Creates git hooks that run guard/score before commits.
 */

import { existsSync, writeFileSync, mkdirSync, chmodSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { c } from '../shared.mjs';

const HOOKS = {
  'pre-commit': {
    description: 'Run docguard guard before every commit',
    content: `#!/bin/sh
# DocGuard pre-commit hook
# Validates CDD compliance before allowing commits
# Install: docguard hooks --type pre-commit
# Remove: rm .git/hooks/pre-commit

echo "🛡️  Running DocGuard guard..."

# Check if docguard is available
if command -v npx &> /dev/null; then
  npx docguard-cli guard
  EXIT_CODE=$?
elif command -v docguard &> /dev/null; then
  docguard guard
  EXIT_CODE=$?
else
  echo "⚠️  DocGuard not found. Skipping guard check."
  echo "   Install: npm install -g docguard"
  exit 0
fi

if [ $EXIT_CODE -eq 1 ]; then
  echo ""
  echo "❌ DocGuard guard FAILED — commit blocked"
  echo "   Fix the errors above, then try again."
  echo "   To skip: git commit --no-verify"
  exit 1
elif [ $EXIT_CODE -eq 2 ]; then
  echo ""
  echo "⚠️  DocGuard guard found warnings — commit allowed"
fi

exit 0
`,
  },

  'pre-push': {
    description: 'Run docguard score check before push (enforce minimum score)',
    content: `#!/bin/sh
# DocGuard pre-push hook
# Enforces minimum CDD score before allowing push
# Install: docguard hooks --type pre-push
# Remove: rm .git/hooks/pre-push

MIN_SCORE=60

echo "📊 Running DocGuard score check (minimum: $MIN_SCORE)..."

# Get score as JSON
if command -v npx &> /dev/null; then
  RESULT=$(npx docguard-cli score --format json 2>/dev/null)
elif command -v docguard &> /dev/null; then
  RESULT=$(docguard score --format json 2>/dev/null)
else
  echo "⚠️  DocGuard not found. Skipping score check."
  exit 0
fi

# Parse score from JSON
SCORE=$(echo "$RESULT" | grep -o '"score":[0-9]*' | head -1 | cut -d: -f2)

if [ -z "$SCORE" ]; then
  echo "⚠️  Could not determine CDD score. Push allowed."
  exit 0
fi

echo "   CDD Score: $SCORE/100"

if [ "$SCORE" -lt "$MIN_SCORE" ]; then
  echo ""
  echo "❌ CDD score $SCORE is below minimum $MIN_SCORE — push blocked"
  echo "   Run: docguard score  (for details)"
  echo "   To skip: git push --no-verify"
  exit 1
fi

echo "   ✅ Score meets minimum threshold"
exit 0
`,
  },

  'commit-msg': {
    description: 'Validate commit message format (conventional commits)',
    content: `#!/bin/sh
# DocGuard commit-msg hook
# Validates conventional commit message format
# Install: docguard hooks --type commit-msg
# Remove: rm .git/hooks/commit-msg

COMMIT_MSG_FILE=$1
COMMIT_MSG=$(cat "$COMMIT_MSG_FILE")

# Conventional commit regex
PATTERN="^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert|release)(\\(.+\\))?: .{1,72}"

if ! echo "$COMMIT_MSG" | head -1 | grep -qE "$PATTERN"; then
  echo ""
  echo "❌ Commit message does not follow Conventional Commits format"
  echo ""
  echo "   Expected: type(scope): description"
  echo "   Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert, release"
  echo ""
  echo "   Examples:"
  echo "     feat: add user authentication"
  echo "     fix(api): resolve timeout on large requests"
  echo "     docs: update ARCHITECTURE.md layer boundaries"
  echo ""
  echo "   Your message: $(head -1 "$COMMIT_MSG_FILE")"
  echo ""
  echo "   To skip: git commit --no-verify"
  exit 1
fi

exit 0
`,
  },
};

export function runHooks(projectDir, config, flags) {
  console.log(`${c.bold}🪝 DocGuard Hooks — ${config.projectName}${c.reset}`);
  console.log(`${c.dim}   Directory: ${projectDir}${c.reset}\n`);

  // Check if .git exists
  const gitDir = resolve(projectDir, '.git');
  if (!existsSync(gitDir)) {
    console.log(`  ${c.red}❌ Not a git repository. Run ${c.cyan}git init${c.red} first.${c.reset}\n`);
    process.exit(1);
  }

  const hooksDir = resolve(gitDir, 'hooks');
  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }

  // Determine which hooks to install
  let hookTypes = Object.keys(HOOKS);
  if (flags.type) {
    if (!HOOKS[flags.type]) {
      console.log(`  ${c.red}Unknown hook type: ${flags.type}${c.reset}`);
      console.log(`  Available: ${Object.keys(HOOKS).join(', ')}\n`);
      process.exit(1);
    }
    hookTypes = [flags.type];
  }

  // List mode
  if (flags.list) {
    console.log(`  ${c.bold}Available hooks:${c.reset}\n`);
    for (const [name, hook] of Object.entries(HOOKS)) {
      const installed = existsSync(resolve(hooksDir, name));
      const status = installed ? `${c.green}✅ installed${c.reset}` : `${c.dim}not installed${c.reset}`;
      console.log(`    ${c.cyan}${name}${c.reset}: ${hook.description} [${status}]`);
    }
    console.log(`\n  ${c.dim}Install: docguard hooks --type <name>${c.reset}`);
    console.log(`  ${c.dim}Install all: docguard hooks${c.reset}\n`);
    return;
  }

  // Remove mode
  if (flags.remove) {
    let removed = 0;
    for (const name of hookTypes) {
      const hookPath = resolve(hooksDir, name);
      if (existsSync(hookPath)) {
        const content = readFileSync(hookPath, 'utf-8');
        if (content.includes('DocGuard')) {
          unlinkSync(hookPath);
          console.log(`  ${c.yellow}🗑️  Removed: ${name}${c.reset}`);
          removed++;
        } else {
          console.log(`  ${c.dim}⏭️  ${name}: not a DocGuard hook (skipped)${c.reset}`);
        }
      }
    }
    console.log(`\n  Removed: ${removed}\n`);
    return;
  }

  // Install mode
  let installed = 0;
  let skipped = 0;

  for (const name of hookTypes) {
    const hookPath = resolve(hooksDir, name);

    if (existsSync(hookPath) && !flags.force) {
      // Check if it's already a DocGuard hook
      const existing = readFileSync(hookPath, 'utf-8');
      if (existing.includes('DocGuard')) {
        console.log(`  ${c.dim}⏭️  ${name} (DocGuard hook already installed)${c.reset}`);
        skipped++;
        continue;
      }
      console.log(`  ${c.yellow}⚠️  ${name}: existing hook found (use --force to overwrite)${c.reset}`);
      skipped++;
      continue;
    }

    writeFileSync(hookPath, HOOKS[name].content, 'utf-8');
    chmodSync(hookPath, 0o755); // Make executable
    console.log(`  ${c.green}✅ ${name}${c.reset}: ${HOOKS[name].description}`);
    installed++;
  }

  console.log(`\n${c.bold}  ─────────────────────────────────────${c.reset}`);
  console.log(`  Installed: ${installed}  Skipped: ${skipped}`);

  if (installed > 0) {
    console.log(`\n  ${c.dim}Hooks run automatically on git operations.${c.reset}`);
    console.log(`  ${c.dim}Skip with: git commit --no-verify${c.reset}`);
    console.log(`  ${c.dim}Remove with: docguard hooks --remove${c.reset}`);
  }

  console.log('');
}
