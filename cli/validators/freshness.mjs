/**
 * Freshness Validator — Identify documentation review tasks from code history.
 * Uses git history to compare when docs were last modified vs when code was last changed.
 * 
 * This is a repository-wide review heuristic, not proof of semantic drift.
 */

import { existsSync, readdirSync, readFileSync, lstatSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildIgnoreFilter, loadDocguardIgnore, DEFAULT_IGNORE_DIRS, relPosix } from '../shared-ignore.mjs';

// Keep aligned with shared-source's supported languages, including module variants.
const CODE_EXTS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.mts', '.cts',
  '.py', '.java', '.go', '.rs', '.rb', '.php'];
const CODE_PATHS = CODE_EXTS.map(ext => `*${ext}`);

function pathFilter(dir, config) {
  const ignored = buildIgnoreFilter([...(config.ignore || []), ...loadDocguardIgnore(dir)]);
  return path => path === '..' || path.startsWith('../') ||
    path.split('/').some(part => part === '.local' || DEFAULT_IGNORE_DIRS.has(part)) || ignored(path);
}

function safeExistingPath(dir, abs) {
  try {
    let current = dir;
    for (const part of relPosix(dir, abs).split('/')) {
      current = join(current, part);
      if (lstatSync(current).isSymbolicLink()) return false;
    }
    return true;
  } catch { return false; }
}

// Unlike a stat-based walk, this never follows a symlink into private/outside data.
function collectDocs(dir, config, ignored) {
  const files = new Set();
  function add(path, recurse = false) {
    if (typeof path !== 'string') return;
    const abs = resolve(dir, path);
    const rel = relPosix(dir, abs);
    if (ignored(rel)) return;
    try {
      if (!safeExistingPath(dir, abs)) return;
      const stat = lstatSync(abs);
      if (stat.isFile()) files.add(rel);
      else if (recurse && stat.isDirectory()) {
        for (const entry of readdirSync(abs, { withFileTypes: true })) {
          if (entry.name.startsWith('.')) continue;
          if (entry.isDirectory() || extname(entry.name).toLowerCase() === '.md') add(join(rel, entry.name), true);
        }
      }
    } catch { /* Missing/unreadable docs are handled by structural validators. */ }
  }
  add('docs-canonical', true);
  // Additional homes are opt-in: inferred doc directories are not review policy.
  for (const path of Array.isArray(config.docs?.dirs) ? config.docs.dirs : []) add(path, true);
  for (const file of config.requiredFiles?.canonical || []) add(file, true);
  const agents = config.requiredFiles?.agentFile || ['AGENTS.md', 'CLAUDE.md'];
  for (const file of Array.isArray(agents) ? agents : [agents]) add(file);
  for (const [file, spec] of Object.entries(config.documentTypes || {})) {
    if (spec?.category === 'canonical') add(file, true);
  }
  add('ROADMAP.md');
  // Changelog and deviation logs have their own review signals below.
  const tracking = [config.requiredFiles?.changelog || 'CHANGELOG.md', config.requiredFiles?.driftLog || 'DRIFT-LOG.md']
    .map(path => relPosix(dir, resolve(dir, path)));
  return [...files].filter(file => !tracking.includes(file)).sort();
}

// B-5 fix (v0.13.1): use a defensive import. If `shared-git.mjs` is missing
// or unloadable in the end-user install (whatever the root cause — partial
// upgrade, package corruption, weird module resolution), we fall back to
// the original inline implementation below. The worst-case outcome is
// "rename detection doesn't work", NOT "validator crashes with a useless
// ReferenceError". Reported by an enterprise client project v0.13.x feedback.
let _sharedGetLastCommitDate = null;
try {
  const mod = await import('../shared-git.mjs');
  if (mod && typeof mod.getLastCommitDate === 'function') {
    _sharedGetLastCommitDate = mod.getLastCommitDate;
  }
} catch {
  // Silently fall back. Test in tests/freshness-resilience.test.mjs verifies
  // the validator stays operational when the import goes sideways.
  _sharedGetLastCommitDate = null;
}

/**
 * Read the `<!-- docguard:last-reviewed YYYY-MM-DD -->` header from a doc file.
 * Returns the parsed Date when present, null otherwise (file missing, header
 * absent, or date unparseable). The header is the authoritative review date
 * — it represents an explicit human review action that `git log` cannot see
 * (e.g., the reviewer read the file, confirmed it still matches reality, and
 * stamped the header without touching content, so there is no commit to find).
 */
export function readLastReviewedDate(absPath) {
  try {
    const content = readFileSync(absPath, 'utf-8');
    const m = content.match(/<!--\s*docguard:last-reviewed\s+(\d{4}-\d{2}-\d{2})\s*-->/);
    if (!m) return null;
    const d = new Date(m[1] + 'T00:00:00Z');
    if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== m[1]) return null;
    // Reject future-dated headers. A typo'd or copy-pasted future date (e.g.
    // 2030-01-01) would otherwise make a genuinely stale doc look "fresh"
    // forever — its age goes negative and "commits since" rounds to zero. A
    // review can't legitimately have happened in the future, so we ignore the
    // header and fall back to the real git date (UTC calendar days).
    if (d.getTime() > Date.now()) return null;
    return d;
  } catch {
    return null;
  }
}

/**
 * Read the `<!-- docguard:status <value> -->` marker (draft | review | approved
 * | living | active | deprecated | historical | superseded). Returns the lowercased value, or null. Used by the uncommitted-doc
 * check (Bug #6): a doc the agent generated this session and marked `approved`
 * has an explicit currency signal even before it's committed.
 */
function readDocStatus(absPath) {
  try {
    const content = readFileSync(absPath, 'utf-8');
    let fence = null;
    for (const line of content.split('\n')) {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (fence) {
        if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length
          && line.slice(marker[0].length).trim() === '') fence = null;
        continue;
      }
      if (marker) { fence = marker[1]; continue; }
      const m = line.match(/^\s*<!--\s*docguard:status\s+([a-z]+)\s*-->\s*$/i);
      if (m) return m[1].toLowerCase();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get the last git commit date for a file.
 * Returns null if the file isn't tracked or git isn't available.
 */
function getLastGitDate(filePath, dir) {
  // Prefer the shared-git --follow-aware path when available (v0.13+ default).
  // Fall back to inline implementation if the import failed at module load —
  // this guarantees the validator never throws a ReferenceError even in
  // environments where ESM resolution is broken.
  if (_sharedGetLastCommitDate) {
    try {
      return _sharedGetLastCommitDate(dir, filePath);
    } catch {
      // fall through to inline
    }
  }
  // Inline pre-v0.13 implementation — works without rename detection, but
  // is guaranteed to not throw a "not defined" error.
  try {
    const result = execFileSync(
      'git',
      ['log', '-1', '--format=%aI', '--', filePath],
      { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    return result ? new Date(result) : null;
  } catch {
    return null;
  }
}

/**
 * Read committed source changes once, including additions and deletions.
 */
function getCodeHistory(dir, ignored) {
  // One query per validation, independent of document count/review dates.
  // NUL-delimited names also handle spaces/newlines without shell parsing.
  const out = execFileSync('git',
    ['log', '--format=%x1e%H%x00%aI%x00%cI', '--name-only', '-z', '--no-renames', '--',
      ...CODE_PATHS, ':(exclude).local/**', ':(exclude)**/.local/**'],
    { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
  return out.split('\x1e').slice(1).map(record => {
    const [hash, authorDate, commitDate, ...names] = record.split('\0');
    const paths = names.map(name => name.replace(/^\n/, '')).filter(name =>
      name && CODE_EXTS.includes(extname(name)) && !ignored(name));
    return { hash, date: new Date(authorDate), since: new Date(commitDate), paths };
  }).filter(commit => commit.paths.length);
}

/**
 * Documents staged in the commit currently being checked.
 *
 * A pre-commit hook runs guard against the very change being made, so a doc the
 * author is updating right now was still being reported "review due" — the work
 * the finding asks for is in the index (field report: AGENTS.md flagged while
 * staged). Returns POSIX-relative paths; empty when git is unavailable.
 */
function getStagedPaths(dir) {
  try {
    const out = execFileSync('git', ['diff', '--cached', '--name-only', '-z'],
      { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return new Set(out.split('\0').filter(Boolean));
  } catch {
    return new Set();
  }
}

/**
 * Check if git is available in this project.
 */
function isGitRepo(dir) {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get total number of commits in the repo.
 */
function getTotalCommits(dir) {
  try {
    return parseInt(execFileSync('git', ['rev-list', '--count', 'HEAD'], {
      cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']
    }).trim()) || 0;
  } catch {
    return 0;
  }
}

/**
 * Evaluate review signals against repository-wide code history.
 */
export function validateFreshness(dir, config) {
  const results = [];

  if (!isGitRepo(dir)) {
    results.push({
      status: 'skip',
      message: 'Not a git repository — freshness check skipped',
    });
    return results;
  }

  const totalCommits = getTotalCommits(dir);
  if (totalCommits < 3) {
    results.push({
      status: 'skip',
      message: `Only ${totalCommits} commits — freshness check needs ≥3 commits`,
    });
    return results;
  }

  // ── 1. Check each canonical doc's last update vs latest code commit ──
  const ignored = pathFilter(dir, config);
  const docFiles = collectDocs(dir, config, ignored);
  let history;
  try { history = getCodeHistory(dir, ignored); } catch {
    return [{ status: 'skip', message: 'Code history unavailable — freshness check skipped' }];
  }
  const latestCodeDate = history[0]?.date || null;
  const counts = new Map();
  const getCodeCommitsSince = date => {
    const key = date.toISOString();
    if (!counts.has(key)) counts.set(key, history.filter(commit => commit.since >= date).length);
    return counts.get(key);
  };

  // Hand-set review triggers, not fitted values. If either is ever derived
  // from observed feedback, it MUST be fitted against a strictly proper
  // scoring rule — see docguard.calibrated-finding-channels#FR-018.
  const REVIEW_THRESHOLD_DAYS = 30; // Repository-wide trigger, not proof of drift
  const WARNING_THRESHOLD_COMMITS = 10; // Repository-wide review trigger

  const stagedPaths = getStagedPaths(dir);

  for (const docFile of docFiles) {
    const docPath = resolve(dir, docFile);
    if (!existsSync(docPath)) continue;
    // Being edited in this very commit is the strongest possible freshness
    // signal; a repository-wide commit count cannot override it.
    if (stagedPaths.has(relPosix(dir, docPath))) {
      results.push({ status: 'skip', doc: docFile,
        message: `${docFile} is staged in this change — review not due; the document is being updated now` });
      continue;
    }
    const docStatus = readDocStatus(docPath);
    if (['historical', 'superseded', 'deprecated'].includes(docStatus)) {
      results.push({ status: 'skip', doc: docFile,
        message: `${docFile} is marked ${docStatus} — currentness review not applicable; historical accuracy is not verified` });
      continue;
    }

    // Prefer the explicit `<!-- docguard:last-reviewed YYYY-MM-DD -->` header
    // over the git commit date. A reviewer who reads a doc and stamps the
    // header without changing content has signaled "I confirmed this is still
    // current" — git log cannot see that signal, so it would falsely flag the
    // doc as stale despite the explicit review. Fall back to git log only when
    // the header is absent. Symmetric with the ALCOA+ "review metadata present"
    // check in score.mjs, which reads the same header.
    const reviewedDate = readLastReviewedDate(docPath);
    const docDate = reviewedDate || getLastGitDate(docFile, dir);
    if (!docDate) {
      // File exists but has no freshness signal (not in git, no last-reviewed).
      // Bug #6: an agent that generated the doc THIS session and stamped it
      // `<!-- docguard:status approved -->` has signaled it's intentionally
      // current. In the generate-then-fill flow the human hasn't committed yet,
      // so the "uncommitted" warning is noise — suppress it for approved docs.
      if (docStatus === 'approved') {
        results.push({
          status: 'pass',
          message: `${docFile} is marked approved (not yet committed; author signal, not semantic verification)`,
        });
        continue;
      }
      // State BOTH satisfiers — the warning used to mention only committing, so
      // an agent that can stamp a marker but not commit was left guessing.
      results.push({
        status: 'warn',
        code: 'FRS001',
        doc: docFile,
        message: `${docFile} exists but is not yet committed to git — review due: no dated review signal. After reviewing intent and implementation, commit it or add a <!-- docguard:last-reviewed YYYY-MM-DD --> marker.`,
      });
      continue;
    }

    // Check how many code commits happened since this doc was last updated.
    // A `last-reviewed` HEADER is day-granular and signals "I reviewed this ON
    // this day" — so it covers commits made that same day. Counting from
    // midnight would flag a doc as stale on the very day it was genuinely
    // reviewed whenever >10 code commits also landed that day (a heavy-dev day),
    // undermining the explicit-review signal this validator otherwise honors.
    // Advance a header date to end-of-day so only commits on LATER days count.
    // Git fallback dates are real timestamps and are used as-is.
    const sinceDate = reviewedDate
      ? new Date(reviewedDate.getTime() + 24 * 60 * 60 * 1000 - 1000)
      : docDate;
    const codeCommitsSince = getCodeCommitsSince(sinceDate);

    if (codeCommitsSince >= WARNING_THRESHOLD_COMMITS) {
      results.push({
        status: 'warn',
        code: 'FRS002',
        doc: docFile,
        message: `${docFile} — review due: ${codeCommitsSince} code commits since last doc update/review (${docDate.toISOString().split('T')[0]}); repository-wide heuristic, not evidence this document is stale`,
      });
      continue;
    }

    // Check age vs latest code commit
    if (latestCodeDate) {
      const daysDiff = Math.floor((latestCodeDate - docDate) / (1000 * 60 * 60 * 24));
      if (daysDiff > REVIEW_THRESHOLD_DAYS) {
        results.push({
          status: 'warn',
          code: 'FRS003',
          doc: docFile,
          message: `${docFile} — review due: last updated ${daysDiff} days before latest code change; repository-wide heuristic, not evidence this document is stale`,
        });
        continue;
      }
    }

    results.push({
      status: 'pass',
      message: `${docFile} — no review due by the repository-wide history heuristic; not proof the document is fresh (not semantic verification)`,
    });
  }

  // ── 2. Check CHANGELOG.md was updated in the last 5 code commits ──
  const changelogPath = resolve(dir, config.requiredFiles?.changelog || 'CHANGELOG.md');
  if (!ignored(relPosix(dir, changelogPath)) && safeExistingPath(dir, changelogPath)
    && !['historical', 'superseded', 'deprecated'].includes(readDocStatus(changelogPath))) {
    const changelogDate =
      readLastReviewedDate(changelogPath) ||
      getLastGitDate(config.requiredFiles?.changelog || 'CHANGELOG.md', dir);
    if (changelogDate && latestCodeDate) {
      const daysDiff = Math.floor((latestCodeDate - changelogDate) / (1000 * 60 * 60 * 24));
      if (daysDiff > 7) {
        results.push({
          status: 'warn',
          code: 'FRS004',
          doc: config.requiredFiles?.changelog || 'CHANGELOG.md',
          message: `${config.requiredFiles?.changelog || 'CHANGELOG.md'} — review due: last updated ${daysDiff} days before latest code change; verify whether release notes are needed`,
        });
      } else {
        results.push({
          status: 'pass',
          message: `${config.requiredFiles?.changelog || 'CHANGELOG.md'} — no review due by the history heuristic (not semantic verification)`,
        });
      }
    }
  }

  // ── 3. Check DRIFT-LOG.md was updated if there are DRIFT comments ──
  const driftPath = resolve(dir, config.requiredFiles?.driftLog || 'DRIFT-LOG.md');
  if (history.length && !ignored(relPosix(dir, driftPath)) && safeExistingPath(dir, driftPath)
    && !['historical', 'superseded', 'deprecated'].includes(readDocStatus(driftPath))) {
    const driftDate = getLastGitDate(config.requiredFiles?.driftLog || 'DRIFT-LOG.md', dir);
    // Check for recent DRIFT comments ADDED to code. The old approach piped
    // `git log --all -p | grep -c DRIFT:`, which counted DRIFT: on removed
    // lines, unchanged context, and every branch (`--all`) — wildly inflating
    // the count and depending on `grep`. Here we read the last-5-commits diff
    // for the current branch and count only ADDED lines (`+`, not the `+++`
    // file header) that introduce a DRIFT comment.
    try {
      const diff = execFileSync(
        'git',
        ['log', '-5', '-p', '--', ...[...new Set(history.slice(0, 5).flatMap(commit => commit.paths))]
          .map(path => `:(literal)${path}`)],
        { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const driftCount = diff
        .split('\n')
        .filter(l => /^\+(?!\+\+)/.test(l) && l.includes('DRIFT:'))
        .length;
      if (driftCount > 0 && driftDate) {
        const codeCommitsSince = getCodeCommitsSince(driftDate);
        if (codeCommitsSince > 3) {
          results.push({
            status: 'warn',
            code: 'FRS005',
            doc: config.requiredFiles?.driftLog || 'DRIFT-LOG.md',
            message: `${config.requiredFiles?.driftLog || 'DRIFT-LOG.md'} — review due: ${driftCount} added DRIFT comment lines found in recent commits; verify whether deviations are already recorded`,
          });
        }
      }
    } catch { /* skip */ }
  }

  // Every warning here is an ESCALATION: a history signal whose judgement
  // belongs to the reader. That is a separate question from how sure the
  // detector is of what it counted.
  //
  // FRS002-FRS005 count commits, days, and added DRIFT lines read directly
  // from Git. Those quantities are facts, so the detector is certain of its
  // observation and reports confidence 'high'; only the inference to
  // staleness is uncertain, and `disposition: 'escalate'` is what carries
  // that. Labelling the whole finding low-confidence — as this adapter did
  // for every warning uniformly — told the reader DocGuard might have
  // miscounted, which was never the claim, and made the finding reportable
  // as a suspected false positive rather than as an unmeasured one.
  //
  // FRS001 is the exception: it fires on the ABSENCE of any dated signal,
  // which an uncommitted file or a shallow clone can produce, so the
  // observation itself is uncertain and stays 'low'.
  return results.map(result => result.status === 'warn' ? {
    ...result,
    confidence: result.code === 'FRS001' ? 'low' : 'high',
    disposition: 'escalate',
    suggestion: { kind: 'review', text: 'Review this history signal against the document’s purpose and intended behavior. Confirm whether documentation or code needs a change; record a review date only after reviewing. Preserve intentional historical content.' },
  } : result);
}
