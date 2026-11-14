/**
 * Append a bounded, machine-owned outcome index without rewriting spec intent.
 * @implements docguard.document-lifecycle#FR-016
 * @implements docguard.completion-one-commit#FR-005
 * @implements docguard.completion-upkeep#FR-011
 */

const START = '<!-- docguard:implementation-outcomes:start -->';
const END = '<!-- docguard:implementation-outcomes:end -->';

function clean(value, max = 500) {
  return String(value || '').replace(/\s+/g, ' ').replace(/[<>`]/g, '').trim().slice(0, max);
}

// docguard.completion-one-commit#FR-005: the evidence blob ids ride at the end of
// the outcome line, after every cleaned field, so user text (stripped of backticks
// by clean()) cannot forge the segment, and the registry's closed key set stays
// untouched (a 0.48.0 reader rejects any new key). These two functions are the
// only code that knows the carrier.
const BLOB_ID = '[0-9a-f]{40}(?:[0-9a-f]{24})?';
const BLOBS_TAIL = new RegExp(` Blobs: ((?:\`[^\`\\n]+\`=\`${BLOB_ID}\`(?:, )?)+)\\.$`);

/** ` Blobs: \`path\`=\`id\`, ….` for a path→blob map, or '' when there is none. */
export function formatOutcomeBlobs(blobs) {
  const entries = Object.entries(blobs || {}).filter(([path, id]) => path && !/[`\n]/.test(path) && new RegExp(`^${BLOB_ID}$`).test(id));
  if (!entries.length) return '';
  return ` Blobs: ${entries.sort(([a], [b]) => a.localeCompare(b)).map(([path, id]) => `\`${path}\`=\`${id}\``).join(', ')}.`;
}

/**
 * The path→blob map recorded for the outcome at `revision`, or null when that
 * outcome has none (a record written before this field existed).
 */
export function readOutcomeBlobs(content, revision) {
  const start = String(content).indexOf(START);
  const end = String(content).indexOf(END, start);
  if (start < 0 || end < 0) return null;
  const line = content.slice(start, end).split('\n').find(item => item.startsWith(`- \`${revision}\``));
  const tail = line && BLOBS_TAIL.exec(line);
  if (!tail) return null;
  const blobs = {};
  for (const [, path, id] of tail[1].matchAll(new RegExp(`\`([^\`\\n]+)\`=\`(${BLOB_ID})\``, 'g'))) blobs[path] = id;
  return Object.keys(blobs).length ? blobs : null;
}

/** The spec with `blobs` set on the outcome line at `revision`; every other byte is unchanged. */
export function writeOutcomeBlobs(content, revision, blobs) {
  const start = content.indexOf(START);
  const end = content.indexOf(END, start);
  const segment = formatOutcomeBlobs(blobs);
  if (start < 0 || end < 0 || !segment) return content;
  const block = content.slice(start, end).split('\n').map(line => (line.startsWith(`- \`${revision}\``)
    ? `${line.replace(BLOBS_TAIL, '')}${segment}` : line)).join('\n');
  return content.slice(0, start) + block + content.slice(end);
}

// The outcome arrives in the registry's canonical form, so the line lists
// evidence and deviations in the order the registry records them
// (docguard.completion-revision-anchoring#FR-007).
export function appendImplementationOutcome(content, outcome) {
  const reason = clean(outcome.reason);
  if (!reason) throw new Error('Implementation outcome requires a non-empty reviewed reason.');
  const evidence = (outcome.evidence || []).map(path => `\`${path}\``).join(', ') || 'none';
  const deviations = (outcome.deviations || []).map(item => clean(item)).filter(Boolean).join('; ') || 'none';
  const successor = outcome.successor ? `\`${outcome.successor}\`` : 'none';
  // A narrowed review says which commits it did not reconcile, and why
  // (docguard.completion-revision-anchoring#FR-009).
  const narrowed = outcome.narrowedFrom;
  const skipped = narrowed
    ? ` Not reconciled: \`${narrowed.revision.slice(0, 12)}\`..\`${narrowed.since.slice(0, 12)}\` (${narrowed.skippedCommits} commit${narrowed.skippedCommits === 1 ? '' : 's'}) — ${clean(narrowed.reason)}`
    : '';
  const line = `- \`${outcome.revision}\` — ${reason} Evidence: ${evidence}. Accepted deviations: ${deviations}. Successor: ${successor}.${skipped}${formatOutcomeBlobs(outcome.evidenceBlobs)}`;
  const block = `${START}\n## Implementation Outcomes\n\n${line}\n${END}`;
  const pattern = new RegExp(`${START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  if (!pattern.test(content)) return `${content.trimEnd()}\n\n${block}\n`;
  const prior = content.match(pattern)?.[0]
    .split('\n').filter(item => item.startsWith('- `')) || [];
  const lines = [...prior.filter(item => !item.startsWith(`- \`${outcome.revision}\``)), line].slice(-20);
  return content.replace(pattern, `${START}\n## Implementation Outcomes\n\n${lines.join('\n')}\n${END}`);
}

const BLOCK_RE = new RegExp(`\\n*${START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`);

/**
 * The spec without its machine-owned outcome block, so a change confined to
 * that block can be told apart from a change to the spec's intent.
 * @implements docguard.completion-revision-anchoring#FR-001
 */
export function stripImplementationOutcomes(content) {
  return String(content).replace(BLOCK_RE, '\n').trimEnd();
}

/**
 * Move one outcome line's revision. Every other byte of the block, and of the
 * spec, is unchanged.
 * @implements docguard.completion-revision-anchoring#FR-003
 */
export function rewriteOutcomeRevision(content, from, to) {
  const start = content.indexOf(START);
  const end = content.indexOf(END, start);
  if (start < 0 || end < 0) return content;
  const block = content.slice(start, end);
  const next = block.split('\n').map(line => (line.startsWith(`- \`${from}\``) ? `- \`${to}\`${line.slice(from.length + 4)}` : line)).join('\n');
  return content.slice(0, start) + next + content.slice(end);
}

// Only a value that says the spec is not done is rewritten. A completed-like value (Active, Implemented,
// Complete, Superseded, As-built, ...) is never touched. Among this repository's closed specs the
// deliberately set values are Active (33) and Implemented (2); Draft (57) is the value nobody updated.
const DRAFT_STATUS = /^(\*\*Status\*\*:[ \t]*)(?:Draft|In Progress|Planned|Proposed|WIP)[ \t]*$/im;

/**
 * The spec with its `**Status**:` header set to `Active` when it still reads a
 * draft value, and every other byte unchanged; any other value (Implemented,
 * Complete, Superseded, As-built) is left alone.
 * @implements docguard.completion-upkeep#FR-011
 */
export function markSpecActive(content) {
  return DRAFT_STATUS.test(content) ? content.replace(DRAFT_STATUS, '$1Active') : content;
}

/** The status the header carries, or null. */
export function readSpecStatus(content) {
  return (/^\*\*Status\*\*:[ \t]*(.+?)[ \t]*$/m.exec(content) || [])[1] || null;
}
