/**
 * Hooks Command — Generate pre-commit/pre-push hooks for DocGuard
 * Creates git hooks that run guard/score before commits.
 */

import { existsSync, writeFileSync, mkdirSync, chmodSync, readFileSync, unlinkSync } from 'node:fs';

// v0.16-P3: managed-block markers. Letting users extend the hook with their
// own commands (data-file guards, lint checks, etc.) without us clobbering
// them on re-install. Format:
//
//   #!/bin/sh
//   # ... user's prelude ...
//
//   # BEGIN DOCGUARD MANAGED — do not edit between these markers
//   ... DocGuard's content ...
//   # END DOCGUARD MANAGED
//
//   # ... user's postlude ...
//
// On re-install, we splice ONLY the content between the markers, preserving
// everything else verbatim. Without markers (legacy hooks or third-party
// pre-existing hooks), behavior falls back to the existing --force flow.
const BEGIN_MARKER = '# BEGIN DOCGUARD MANAGED — do not edit between these markers';
const END_MARKER   = '# END DOCGUARD MANAGED';

/**
 * Wrap a hook body in BEGIN/END markers so future re-installs can splice
 * just the managed portion. The shebang stays at the top, outside the block.
 */
function wrapManaged(body) {
  // Pull shebang off the front if present so it stays at the top.
  const lines = body.split('\n');
  let shebang = '';
  if (lines[0] && lines[0].startsWith('#!')) {
    shebang = lines.shift() + '\n';
  }
  return `${shebang}${BEGIN_MARKER}\n${lines.join('\n').replace(/\n+$/, '')}\n${END_MARKER}\n`;
}

/**
 * Splice DocGuard's managed content into an existing hook file that has
 * the BEGIN/END markers. Returns the new file content (string) or null
 * when the markers aren't found (caller falls back to legacy behavior).
 */
function spliceManagedBlock(existing, newBody) {
  const startIdx = existing.indexOf(BEGIN_MARKER);
  const endIdx   = existing.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return null;
  const before = existing.slice(0, startIdx);
  const after  = existing.slice(endIdx + END_MARKER.length);
  // newBody has its own shebang — strip it since we're splicing into the
  // middle of an existing file (which already has one).
  const bodyNoShebang = newBody.replace(/^#!.*\n/, '');
  return `${before}${BEGIN_MARKER}\n${bodyNoShebang.replace(/\n+$/, '')}\n${END_MARKER}${after}`;
}
import { resolve } from 'node:path';
import { c } from '../shared.mjs';
import { getHooksDir } from '../shared-git.mjs';

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

// Auto-fix variant of the pre-commit hook: apply deterministic fixes, re-stage,
// then validate. Installed with: docguard hooks --type pre-commit --auto-fix
const PRE_COMMIT_AUTOFIX = `#!/bin/sh
# DocGuard pre-commit hook (auto-fix mode)
# Applies deterministic (no-LLM) fixes, then validates.
# Install: docguard hooks --type pre-commit --auto-fix
# Remove: rm .git/hooks/pre-commit

RUN="npx docguard-cli"
if command -v docguard >/dev/null 2>&1; then RUN="docguard"; fi

echo "🛡️  DocGuard: applying mechanical fixes…"
# 1. Deterministically remove stale documented endpoints (safe, no AI).
$RUN fix --write
# 2. Re-stage anything DocGuard rewrote so the fix is part of THIS commit.
git add docs-canonical/ 2>/dev/null

# 3. Validate.
$RUN guard
EXIT_CODE=$?

if [ $EXIT_CODE -eq 1 ]; then
  echo ""
  echo "❌ DocGuard guard FAILED — commit blocked."
  echo "   Remaining issues need an AI agent (content rewrites, not mechanical):"
  echo "   Run: $RUN diagnose   (emits ready-to-paste agent fix prompts)"
  echo "   To skip: git commit --no-verify"
  exit 1
elif [ $EXIT_CODE -eq 2 ]; then
  echo "⚠️  DocGuard guard found warnings — commit allowed"
fi
exit 0
`;

export function runHooks(projectDir, config, flags) {
  console.log(`${c.bold}🪝 DocGuard Hooks — ${config.projectName}${c.reset}`);
  console.log(`${c.dim}   Directory: ${projectDir}${c.reset}\n`);

  // Resolve the real hooks dir via git — NOT `<projectDir>/.git/hooks`, which
  // is wrong inside a linked worktree (where `.git` is a file, not a dir) and
  // ignores a custom core.hooksPath.
  const hooksDir = getHooksDir(projectDir);
  if (!hooksDir) {
    console.log(`  ${c.red}❌ Not a git repository. Run ${c.cyan}git init${c.red} first.${c.reset}\n`);
    process.exit(1);
  }

  // Only create the dir when we're actually going to write a hook. Read-only
  // modes (--list, --remove) must not have a filesystem side effect.
  const ensureHooksDir = () => {
    if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });
  };

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
  ensureHooksDir();
  let installed = 0;
  let skipped = 0;

  for (const name of hookTypes) {
    const hookPath = resolve(hooksDir, name);
    const useAutofix = name === 'pre-commit' && flags.autoFix;
    const newContent = wrapManaged(useAutofix ? PRE_COMMIT_AUTOFIX : HOOKS[name].content);
    const desc = useAutofix ? 'Apply mechanical fixes (fix --write) then guard' : HOOKS[name].description;

    if (existsSync(hookPath)) {
      const existing = readFileSync(hookPath, 'utf-8');

      // v0.16-P3: managed-block path — splice just the DocGuard portion,
      // preserve everything outside it. The user can extend the hook with
      // their own commands above/below the markers without losing them on
      // re-install.
      const spliced = spliceManagedBlock(existing, newContent);
      if (spliced !== null) {
        writeFileSync(hookPath, spliced, 'utf-8');
        chmodSync(hookPath, 0o755);
        console.log(`  ${c.green}↻ ${name}${c.reset}: updated DocGuard managed block (preserved user content around it)`);
        installed++;
        continue;
      }

      // No markers found. Two sub-cases:
      //   (a) Legacy DocGuard hook (pre-v0.16, no markers, contains "DocGuard")
      //       → upgrade in place when --force is set
      //   (b) Third-party hook the user wrote themselves
      //       → refuse without --force; warn about clobber risk
      if (!flags.force) {
        if (existing.includes('DocGuard')) {
          console.log(`  ${c.yellow}⚠️  ${name}: legacy DocGuard hook (pre-v0.16) without managed markers. Re-run with --force to upgrade it to the managed-block format.${c.reset}`);
        } else {
          console.log(`  ${c.yellow}⚠️  ${name}: an existing hook is present and has no DocGuard markers. Re-run with --force to overwrite (your hook will be replaced — back it up first!).${c.reset}`);
        }
        skipped++;
        continue;
      }
      // --force path: write fresh managed-block version
    }

    writeFileSync(hookPath, newContent, 'utf-8');
    chmodSync(hookPath, 0o755);
    console.log(`  ${c.green}✅ ${name}${c.reset}: ${desc}`);
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
