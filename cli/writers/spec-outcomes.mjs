/**
 * Append a bounded, machine-owned outcome index without rewriting spec intent.
 * @implements docguard.document-lifecycle#FR-016
 */

const START = '<!-- docguard:implementation-outcomes:start -->';
const END = '<!-- docguard:implementation-outcomes:end -->';

function clean(value, max = 500) {
  return String(value || '').replace(/\s+/g, ' ').replace(/[<>`]/g, '').trim().slice(0, max);
}

export function appendImplementationOutcome(content, outcome) {
  const reason = clean(outcome.reason);
  if (!reason) throw new Error('Implementation outcome requires a non-empty reviewed reason.');
  const evidence = [...new Set(outcome.evidence || [])].sort().map(path => `\`${path}\``).join(', ') || 'none';
  const deviations = [...new Set(outcome.deviations || [])].sort().map(item => clean(item)).filter(Boolean).join('; ') || 'none';
  const successor = outcome.successor ? `\`${outcome.successor}\`` : 'none';
  const line = `- \`${outcome.revision}\` — ${reason} Evidence: ${evidence}. Accepted deviations: ${deviations}. Successor: ${successor}.`;
  const block = `${START}\n## Implementation Outcomes\n\n${line}\n${END}`;
  const pattern = new RegExp(`${START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  if (!pattern.test(content)) return `${content.trimEnd()}\n\n${block}\n`;
  const prior = content.match(pattern)?.[0]
    .split('\n').filter(item => item.startsWith('- `')) || [];
  const lines = [...prior.filter(item => !item.startsWith(`- \`${outcome.revision}\``)), line].slice(-20);
  return content.replace(pattern, `${START}\n## Implementation Outcomes\n\n${lines.join('\n')}\n${END}`);
}
