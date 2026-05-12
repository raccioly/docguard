import { validateMetricsConsistency } from './cli/validators/metrics-consistency.mjs';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'docguard-test-'));

try {
  writeFileSync(join(tmpDir, 'README.md'), 'We have 20 checks, 12 validators.');

  const guardResults = [];
  for(let i=0; i<11; i++) {
    guardResults.push({ status: 'passed', total: i === 0 ? 5 : 1 });
  }

  const result = validateMetricsConsistency(tmpDir, {}, guardResults);
  console.log(result);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
