import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { scanFrontend } from '../cli/scanners/frontend.mjs';

function write(dir, rel, content) {
  const full = join(dir, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

describe('frontend scanner', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'docguard-fe-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('extracts React Router screens and unwraps guard/layout wrappers', () => {
    write(tmp, 'package.json', JSON.stringify({ dependencies: { react: '^19', 'react-router-dom': '^6', zustand: '^4', '@tanstack/react-query': '^5' }, devDependencies: { vite: '^7' } }));
    write(tmp, 'src/App.tsx', `
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/admin/users" element={<RequireAuth><AdminUsersPage /></RequireAuth>} />
        <Route path="/dashboard" element={<Suspense fallback={<Spinner/>}><Dashboard /></Suspense>} />
      </Routes>
    `);
    const r = scanFrontend(tmp, { sourceRoot: 'src' });
    assert.equal(r.framework, 'React Router');
    assert.equal(r.buildTool, 'Vite');
    assert.equal(r.stateLib, 'Zustand');
    assert.equal(r.dataLib, 'TanStack Query');
    const byPath = Object.fromEntries(r.screens.map(s => [s.path, s.component]));
    assert.equal(byPath['/login'], 'LoginPage');
    assert.equal(byPath['/admin/users'], 'AdminUsersPage', 'unwraps RequireAuth');
    assert.equal(byPath['/dashboard'], 'Dashboard', 'unwraps Suspense');
  });

  it('normalizes route params to {param}', () => {
    write(tmp, 'package.json', JSON.stringify({ dependencies: { 'react-router-dom': '^6' } }));
    write(tmp, 'src/routes.tsx', `<Route path="/groups/:groupId/widget" element={<WidgetPage/>} />`);
    const r = scanFrontend(tmp, { sourceRoot: 'src' });
    assert.ok(r.screens.some(s => s.path === '/groups/{groupId}/widget'));
  });

  it('extracts Next.js App Router screens from page files', () => {
    write(tmp, 'package.json', JSON.stringify({ dependencies: { next: '^15', react: '^19' } }));
    write(tmp, 'app/page.tsx', 'export default function Home(){}');
    write(tmp, 'app/dashboard/page.tsx', 'export default function D(){}');
    write(tmp, 'app/users/[id]/page.tsx', 'export default function U(){}');
    write(tmp, 'app/(marketing)/about/page.tsx', 'export default function A(){}');
    const r = scanFrontend(tmp, {});
    assert.equal(r.framework, 'Next.js');
    const paths = r.screens.map(s => s.path).sort();
    assert.ok(paths.includes('/'));
    assert.ok(paths.includes('/dashboard'));
    assert.ok(paths.includes('/users/{id}'));
    assert.ok(paths.includes('/about'), 'route group (marketing) stripped');
  });

  it('extracts Next.js Pages Router screens, excluding api and _files', () => {
    write(tmp, 'package.json', JSON.stringify({ dependencies: { next: '^14' } }));
    write(tmp, 'pages/index.tsx', 'export default function I(){}');
    write(tmp, 'pages/settings.tsx', 'export default function S(){}');
    write(tmp, 'pages/_app.tsx', 'export default function App(){}');
    write(tmp, 'pages/api/users.ts', 'export default function h(){}');
    const r = scanFrontend(tmp, {});
    const paths = r.screens.map(s => s.path);
    assert.ok(paths.includes('/'));
    assert.ok(paths.includes('/settings'));
    assert.ok(!paths.some(p => p.includes('_app')), '_app excluded');
    assert.ok(!paths.some(p => p.includes('api')), 'api excluded');
  });

  it('inventories components under components/ dirs, skipping tests/stories', () => {
    write(tmp, 'package.json', JSON.stringify({ dependencies: { react: '^19', 'react-router-dom': '^6' } }));
    write(tmp, 'src/components/Button.tsx', 'export const Button=()=>null;');
    write(tmp, 'src/components/forms/LoginForm.tsx', 'export const LoginForm=()=>null;');
    write(tmp, 'src/components/Button.test.tsx', 'test');
    write(tmp, 'src/components/Button.stories.tsx', 'stories');
    write(tmp, 'src/utils/helper.ts', 'export const x=1;'); // not a component
    const r = scanFrontend(tmp, { sourceRoot: 'src' });
    const names = r.components.map(c => c.name);
    assert.ok(names.includes('Button'));
    assert.ok(names.includes('LoginForm'));
    assert.ok(!names.includes('helper'));
    assert.equal(r.components.filter(c => c.name === 'Button').length, 1, 'no test/story dupes');
  });
});
