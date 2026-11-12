/**
 * Doc-Ownership validator: every source directory has one responsible doc
 * section, and the map and a committed Devin wiki file stay true
 * (specs/034-doc-ownership-map).
 *
 *   OWN001  unowned source directory under a root
 *   OWN002  two entries equally specific for one file
 *   OWN003  an entry pattern or root that matches no tracked file
 *   OWN004  an entry whose doc or section does not exist
 *   OWN005  .devin/wiki.json breaks one of Devin's documented rules
 *   OWN006  a path named in .devin/wiki.json that does not exist
 *   OWN007  an unreadable ownership block or wiki file, or an unsafe pattern
 *   OWN008  an entry whose written purpose is blank or a `<placeholder>`
 *
 * Not applicable without an `ownership` block and without `.devin/wiki.json`,
 * so such projects' guard output is unchanged (FR-007).
 *
 * @implements docguard.doc-ownership-map#FR-003
 * @implements docguard.doc-ownership-map#FR-007
 */

import { mkFinding, resultFromFindings } from '../findings.mjs';
import {
  DEVIN_WIKI, entryTargetProblem, lintDevinWiki, loadOwnership, ownershipReport, projectFiles,
} from '../scanners/doc-ownership.mjs';
import { contractFields } from '../shared-result-contract.mjs';
import { canonicalDocPaths, explainPaddedEmpty, firstProductSource, sample } from '../shared-project-evidence.mjs';

const MAX_PER_CODE = 25;

/**
 * Does this kind of check belong to the project? It does when the project has
 * canonical documents and source code: someone is then responsible for saying
 * which section explains which code. The map is the declaration the validator
 * asks for (specs/097-strict-by-default FR-006); a tool can draft one, not know it.
 *
 * @implements docguard.strict-by-default#FR-006
 */
export function applies(projectDir, config = {}) {
  const docs = canonicalDocPaths(projectDir, config);
  if (docs.length === 0) return { applies: false, evidence: 'the project has no canonical document (docs-canonical/ or a mapped document role) that could own source code', docs };
  const source = firstProductSource(projectDir, config);
  if (!source) return { applies: false, evidence: `${docs.length} canonical document(s) (${sample(docs)}) but no source file for a section to own`, docs };
  return { applies: true, evidence: `${docs.length} canonical document(s) (${sample(docs)}) and source code (${source}) that a section can own`, docs, source };
}

function ownHow(d, { entriesMissing }) {
  const doc = d.docs?.[0] || 'docs-canonical/ARCHITECTURE.md';
  const dir = (d.source || 'src/x').includes('/') ? `${d.source.slice(0, d.source.indexOf('/'))}/**` : '<dir>/**';
  return `${entriesMissing ? 'The ownership block has no entries. ' : ''}Add an "ownership" block to .docguard.json and write every value yourself: { "entries": [ { "doc": "${doc}", "section": "<section id or heading anchor in that document>", "purpose": "<one sentence, written by a person, saying what that section explains>", "paths": ["${dir}"] } ] }. \`docguard trace --owners --suggest\` drafts a block, but its purposes are placeholders (OWN008) and its assignments are guesses: edit every entry before you commit it.`;
}
const NO_OWNER_SUBJECT = 'Nothing to configure unless the project has canonical documents (docs-canonical/) and source code: an ownership entry names the document section responsible for a path.';

export function validateDocOwnership(projectDir, config = {}) {
  const map = loadOwnership(projectDir, config);
  const wiki = lintDevinWiki(projectDir, config);
  if (!map.present && !wiki.present) {
    return {
      ...resultFromFindings([], { passed: 0, total: 0 }), applicable: false, note: 'no ownership block and no .devin/wiki.json',
      ...contractFields({
        performed: 0,
        decide: () => applies(projectDir, config),
        empty: d => (d.applies
          ? { emptyCause: 'needs-declaration', note: `Doc-Ownership has no ownership map to check: ${d.evidence}, but .docguard.json has no ownership block and the project has no .devin/wiki.json.`, howToConfigure: ownHow(d, { entriesMissing: false }) }
          : { emptyCause: 'nothing-of-this-kind', note: `Doc-Ownership has no ownership map and no subject for one: ${d.evidence}.`, howToConfigure: NO_OWNER_SUBJECT }),
      }),
    };
  }
  const findings = [];
  let total = 0;
  // Presence of a block or a wiki file is not a check. `total` keeps counting it
  // (counts and the badge are unchanged under `standard`); `performed` does not
  // (specs/097-strict-by-default FR-004).
  let presence = 0;
  const limitations = [];
  const push = (code, props) => {
    const already = findings.filter(f => f.code === code).length;
    if (already >= MAX_PER_CODE) return;
    findings.push(mkFinding({ code, validator: 'docOwnership', confidence: 'high', ...props }));
  };

  if (map.present) {
    total++;
    presence++;
    if (map.error) {
      push('OWN007', {
        severity: 'error', disposition: 'act', message: map.error, location: '.docguard.json',
        suggestion: { kind: 'fix', text: 'Fix the ownership block; until then no path counts as owned' },
      });
    } else {
      const report = ownershipReport(projectDir, config);
      if (!report.tracked) limitations.push('git unavailable: checked the working tree instead of tracked files');
      for (const dir of report.unowned) {
        total++;
        push('OWN001', {
          severity: 'warn', disposition: 'escalate',
          message: `${dir} has source code that no ownership entry covers`,
          location: dir,
          suggestion: { kind: 'review', text: 'Add it to the paths of the doc section that describes it, or add an entry for it' },
        });
      }
      for (const tie of report.ties) {
        total++;
        push('OWN002', {
          severity: 'warn', disposition: 'escalate',
          message: `${tie.entries.map(e => e.key).join(' and ')} are equally specific owners of ${tie.example}${tie.count > 1 ? ` and ${tie.count - 1} other files` : ''}`,
          location: tie.example,
          suggestion: { kind: 'review', text: 'Narrow one entry, or name the file exactly in the entry that owns it' },
        });
      }
      for (const root of report.deadRoots) {
        total++;
        push('OWN003', {
          severity: 'warn', disposition: 'act', message: `ownership root ${root} matches no tracked file`, location: '.docguard.json',
          suggestion: { kind: 'fix', text: 'Remove the root or point it at where the code lives now' },
        });
      }
      for (const { entry, deadPatterns } of report.entries) {
        total += 2;
        if (deadPatterns.length) {
          const allDead = deadPatterns.length === entry.patterns.length;
          push('OWN003', {
            severity: 'warn', disposition: 'act', confidence: allDead ? 'high' : 'low',
            message: `ownership entry ${entry.key}: ${deadPatterns.map(p => JSON.stringify(p)).join(', ')} match${deadPatterns.length === 1 ? 'es' : ''} no tracked file`,
            location: '.docguard.json',
            suggestion: { kind: 'fix', text: 'Point the pattern at where the code lives now, or remove it' },
          });
        }
        if (entry.placeholderPurpose) {
          push('OWN008', {
            severity: 'warn', disposition: 'act', message: `ownership entry ${entry.key}: purpose is ${entry.purpose ? JSON.stringify(entry.purpose) : 'empty'}, a placeholder, so the entry documents nothing`, location: '.docguard.json',
            suggestion: { kind: 'fix', text: 'Write one sentence saying what this doc section is responsible for, or remove the purpose' },
          });
        }
        const problem = entryTargetProblem(projectDir, entry);
        if (problem) {
          push('OWN004', {
            severity: 'warn', disposition: 'act', message: `ownership entry ${entry.key}: ${problem}`, location: '.docguard.json',
            suggestion: { kind: 'fix', text: 'Name an existing doc and a section id or heading anchor in it' },
          });
        }
      }
    }
  }

  if (wiki.present) {
    total++;
    presence++;
    if (wiki.error) {
      push('OWN007', {
        severity: 'error', disposition: 'act', message: wiki.error, location: DEVIN_WIKI.path,
        suggestion: { kind: 'fix', text: 'Fix the JSON so Devin can read it' },
      });
    } else {
      for (const p of wiki.problems) {
        total++;
        push('OWN005', {
          severity: 'warn', disposition: 'act', message: `${DEVIN_WIKI.path} ${p.where}: ${p.message}`, location: DEVIN_WIKI.path,
          suggestion: { kind: 'fix', text: `Keep within Devin's documented rules (${DEVIN_WIKI.source}, checked ${DEVIN_WIKI.checked})` },
        });
      }
      const { files } = projectFiles(projectDir, config);
      const fileSet = new Set(files);
      const dirs = new Set();
      for (const f of files) for (let i = f.indexOf('/'); i !== -1; i = f.indexOf('/', i + 1)) dirs.add(f.slice(0, i));
      for (const { where, path } of wiki.paths) {
        total++;
        const clean = path.replace(/\/$/, '');
        if (fileSet.has(clean) || dirs.has(clean)) continue;
        push('OWN006', {
          severity: 'warn', disposition: 'act',
          message: `${DEVIN_WIKI.path} ${where} names ${path}, which is not in the repository; the note steers Devin's wiki toward it`,
          location: DEVIN_WIKI.path,
          suggestion: { kind: 'fix', text: 'Point the note at the path that replaced it, or remove it' },
        });
      }
    }
  }

  const performed = Math.max(0, total - presence);
  const result = {
    ...resultFromFindings(findings, { passed: Math.max(0, total - findings.length), total }),
    ...explainPaddedEmpty(contractFields({
      performed,
      found: findings.length > 0,
      ran: `${performed} ownership check(s) made against the project's files`,
      decide: () => applies(projectDir, config),
      empty: d => (d.applies
        ? {
          emptyCause: 'needs-content',
          note: map.present
            ? `Doc-Ownership has an ownership block with no entries to check: ${d.evidence}.`
            : `Doc-Ownership has a .devin/wiki.json that names no path to check: ${d.evidence}.`,
          howToConfigure: map.present ? ownHow(d, { entriesMissing: true }) : `${DEVIN_WIKI.path} names no page or note path to check. Add the notes and pages Devin should read, or add an "ownership" block as well: ${ownHow(d, { entriesMissing: false })}`,
        }
        : { emptyCause: 'nothing-of-this-kind', note: `Doc-Ownership has nothing to own: ${d.evidence}.`, howToConfigure: NO_OWNER_SUBJECT }),
    })),
  };
  if (limitations.length) result.applicability = { status: 'partial', reason: limitations.join('; ') };
  return result;
}
