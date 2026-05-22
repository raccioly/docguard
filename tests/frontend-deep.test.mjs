import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { scanFrontend } from '../cli/scanners/frontend.mjs';

function make(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-fe-deep-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe('frontend deep scan — stores, hooks, contexts, api calls', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('detects Zustand, Redux Toolkit, Jotai, MobX stores', () => {
    dir = make({
      'package.json': JSON.stringify({ dependencies: {
        react: '^19', 'react-router-dom': '^6',
        zustand: '^4', '@reduxjs/toolkit': '^2', jotai: '^2', mobx: '^6',
      } }),
      'src/stores/useToast.ts': `import { create } from 'zustand';
        export const useToastStore = create((set) => ({ msg: '' }));`,
      'src/stores/userSlice.ts': `import { createSlice } from '@reduxjs/toolkit';
        const userSlice = createSlice({ name: 'user', initialState: {} });`,
      'src/stores/atoms.ts': `import { atom } from 'jotai';
        export const themeAtom = atom('dark');`,
      'src/stores/CartStore.ts': `class CartStore {
          items = [];
          constructor() { makeAutoObservable(this); }
        }`,
      'src/App.tsx': '<Route path="/" element={<Home/>}/>',
    });
    const r = scanFrontend(dir, { sourceRoot: 'src' });
    const byLib = Object.fromEntries(r.stores.map(s => [s.name, s.library]));
    assert.equal(byLib.useToastStore, 'Zustand');
    assert.equal(byLib.user, 'Redux Toolkit');
    assert.equal(byLib.themeAtom, 'Jotai');
    assert.equal(byLib.CartStore, 'MobX');
  });

  it('inventories exported custom hooks (use*) and skips tests/stories', () => {
    dir = make({
      'package.json': JSON.stringify({ dependencies: { react: '^19', 'react-router-dom': '^6' } }),
      'src/App.tsx': '<Route path="/" element={<Home/>}/>',
      'src/hooks/useAuth.ts': 'export function useAuth() { return { user: null }; }',
      'src/hooks/useFlags.ts': 'export const useFlags = () => ({});',
      'src/hooks/index.ts': "export { useFlags } from './useFlags'; export { useFeatureToggle as useFeature } from './ft';",
      'src/hooks/useAuth.test.ts': 'test',
      'src/components/Page.tsx': 'function Helper(){} export {Helper}',
    });
    const r = scanFrontend(dir, { sourceRoot: 'src' });
    const names = r.hooks.map(h => h.name);
    assert.ok(names.includes('useAuth'));
    assert.ok(names.includes('useFlags'));
    assert.ok(names.includes('useFeature'), 'export-rename also picked up');
    assert.ok(!names.includes('Helper'), 'non-hook export ignored');
  });

  it('detects React Contexts', () => {
    dir = make({
      'package.json': JSON.stringify({ dependencies: { react: '^19', 'react-router-dom': '^6' } }),
      'src/App.tsx': '<Route path="/" element={<Home/>}/>',
      'src/context/AuthContext.tsx': `import { createContext } from 'react';
        export const AuthContext = createContext(null);`,
      'src/context/ThemeContext.tsx': `const ThemeContext = React.createContext('light');`,
    });
    const r = scanFrontend(dir, { sourceRoot: 'src' });
    const names = r.contexts.map(c => c.name);
    assert.ok(names.includes('AuthContext'));
    assert.ok(names.includes('ThemeContext'));
  });

  it('maps API calls (axios/fetch/custom client) to method + path', () => {
    dir = make({
      'package.json': JSON.stringify({ dependencies: { react: '^19', 'react-router-dom': '^6', axios: '^1' } }),
      'src/App.tsx': '<Route path="/" element={<Home/>}/>',
      'src/api/users.ts': `import axios from 'axios';
        export const listUsers = () => axios.get('/api/users');
        export const createUser = (u) => axios.post('/api/users', u);
      `,
      'src/api/health.ts': `export async function ping() {
        const r = await fetch('/api/health');
        return r.json();
      }`,
      'src/api/orders.ts': `export const cancel = (id) => apiClient.delete('/api/orders/' + id);`,
    });
    const r = scanFrontend(dir, { sourceRoot: 'src' });
    const keys = r.apiCalls.map(c => `${c.method} ${c.path}`);
    assert.ok(keys.includes('GET /api/users'));
    assert.ok(keys.includes('POST /api/users'));
    assert.ok(keys.includes('GET /api/health'), 'bare fetch defaults to GET');
    assert.ok(keys.some(k => k.startsWith('DELETE /api/orders')));
  });
});
