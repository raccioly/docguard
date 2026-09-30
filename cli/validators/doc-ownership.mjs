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

const MAX_PER_CODE = 25;

export function validateDocOwnership(projectDir, config = {}) {
  const map = loadOwnership(projectDir, config);
  const wiki = lintDevinWiki(projectDir, config);
  if (!map.present && !wiki.present) {
    return { ...resultFromFindings([], { passed: 0, total: 0 }), applicable: false, note: 'no ownership block and no .devin/wiki.json' };
  }
  const findings = [];
  let total = 0;
  const limitations = [];
  const push = (code, props) => {
    const already = findings.filter(f => f.code === code).length;
    if (already >= MAX_PER_CODE) return;
    findings.push(mkFinding({ code, validator: 'docOwnership', confidence: 'high', ...props }));
  };

  if (map.present) {
    total++;
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

  const result = resultFromFindings(findings, { passed: Math.max(0, total - findings.length), total });
  if (limitations.length) result.applicability = { status: 'partial', reason: limitations.join('; ') };
  return result;
}
