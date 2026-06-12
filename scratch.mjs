import { getHooksDir } from './cli/shared-git.mjs';
import { mkdtempSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';

function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-v020-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'v020-test', version: '0.0.1' }));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

const dir = makeFixture();
console.log('Hooks Dir:', getHooksDir(dir));
