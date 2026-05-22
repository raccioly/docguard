import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { scanFrontend } from '../cli/scanners/frontend.mjs';

function make(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-i18n-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe('frontend i18n scanner', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('extracts t(...) keys and i18nKey props, reads locale JSONs, flags missing keys', () => {
    dir = make({
      'package.json': JSON.stringify({ dependencies: { react: '^19', 'react-router-dom': '^6', i18next: '^23' } }),
      'src/App.tsx': '<Route path="/" element={<Home/>}/>',
      'src/components/Home.tsx': `
        import { useTranslation } from 'react-i18next';
        export function Home() {
          const { t } = useTranslation();
          return (
            <div>
              <h1>{t('home.title')}</h1>
              <p>{t('home.subtitle')}</p>
              <Trans i18nKey="home.cta" />
              <span>{t('admin.users.deleteConfirm')}</span>
            </div>
          );
        }
      `,
      // Locale file is missing the deleteConfirm key (real drift).
      'src/i18n/locales/en.json': JSON.stringify({
        home: { title: 'Hi', subtitle: 'Welcome', cta: 'Go' },
        admin: { users: {} },
      }),
    });
    const r = scanFrontend(dir, { sourceRoot: 'src' });
    assert.ok(r.i18n.usedKeys.includes('home.title'), 'extracts t() key');
    assert.ok(r.i18n.usedKeys.includes('home.subtitle'));
    assert.ok(r.i18n.usedKeys.includes('home.cta'), 'extracts i18nKey JSX prop');
    assert.ok(r.i18n.usedKeys.includes('admin.users.deleteConfirm'));

    assert.equal(r.i18n.locales.length, 1);
    // Flatten leaf-keys only: home.title, home.subtitle, home.cta = 3 (admin.users is an empty {} → no leaves).
    assert.equal(r.i18n.locales[0].keys, 3);

    assert.deepEqual(r.i18n.missing, ['admin.users.deleteConfirm'], 'flags exactly the missing key');
  });

  it('returns empty when there are no translation calls', () => {
    dir = make({
      'package.json': JSON.stringify({ dependencies: { react: '^19', 'react-router-dom': '^6' } }),
      'src/App.tsx': '<Route path="/" element={<Home/>}/>',
      'src/components/Home.tsx': 'export const Home=()=>null;',
    });
    const r = scanFrontend(dir, { sourceRoot: 'src' });
    assert.equal(r.i18n.usedKeys.length, 0);
    assert.equal(r.i18n.missing.length, 0);
  });
});
