import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildIgnoreFilter, shouldIgnore, globMatch } from '../cli/shared-ignore.mjs';

describe('shared-ignore.mjs', () => {
  describe('buildIgnoreFilter', () => {
    it('returns a function that always returns false for empty patterns', () => {
      const filter = buildIgnoreFilter([]);
      assert.strictEqual(filter('src/app.js'), false);
      assert.strictEqual(filter('test.js'), false);
    });

    it('matches exact paths', () => {
      const filter = buildIgnoreFilter(['src/foo.ts']);
      assert.strictEqual(filter('src/foo.ts'), true);
      assert.strictEqual(filter('src/bar.ts'), false);
    });

    it('matches files in subdirectories (ends with /pattern)', () => {
      const filter = buildIgnoreFilter(['foo.ts']);
      assert.strictEqual(filter('src/foo.ts'), true);
      assert.strictEqual(filter('backend/src/foo.ts'), true);
    });

    it('matches directories (starts with pattern/)', () => {
      const filter = buildIgnoreFilter(['src/']);
      assert.strictEqual(filter('src/foo.ts'), true);
      assert.strictEqual(filter('src/components/button.tsx'), true);
    });

    it('matches patterns in the middle of a path', () => {
      // "internal" matches /internal/ via the /escaped/ part of the regex
      const filter = buildIgnoreFilter(['internal']);
      assert.strictEqual(filter('src/internal/utils.js'), true);
      assert.strictEqual(filter('packages/core/internal/index.ts'), true);
    });

    it('handles dots in patterns correctly', () => {
      const filter = buildIgnoreFilter(['.env']);
      assert.strictEqual(filter('.env'), true);
      assert.strictEqual(filter('config/.env'), true);
      assert.strictEqual(filter('envy'), false);
    });

    it('supports * wildcard (matches any chars except /)', () => {
      const filter = buildIgnoreFilter(['*.test.ts']);
      assert.strictEqual(filter('app.test.ts'), true);
      assert.strictEqual(filter('src/app.test.ts'), true);
      assert.strictEqual(filter('src/tests/app.test.ts'), true);
      assert.strictEqual(filter('app.test.js'), false);
      // If * matched /, then "a/b.test.ts" would match "a*.test.ts"
      const filter2 = buildIgnoreFilter(['a*.test.ts']);
      assert.strictEqual(filter2('a/b.test.ts'), false, '* should not match /');
    });

    it('supports ** wildcard (matches any path segments)', () => {
      const filter = buildIgnoreFilter(['packages/**/dist']);
      assert.strictEqual(filter('packages/core/dist'), true);
      assert.strictEqual(filter('packages/ui/components/dist'), true);
      // packages/**/dist means packages/, then something, then /dist
      // packages/dist doesn't match because it's missing the "something" and the extra slash
      assert.strictEqual(filter('packages/dist'), false);
    });

    it('handles multiple patterns correctly', () => {
      const filter = buildIgnoreFilter(['*.log', 'tmp/']);
      assert.strictEqual(filter('error.log'), true);
      assert.strictEqual(filter('tmp/file.txt'), true);
      assert.strictEqual(filter('src/app.js'), false);
    });
  });

  describe('shouldIgnore', () => {
    const config = {
      ignore: ['dist/', '*.log'],
      securityIgnore: ['tests/secrets.json']
    };

    it('respects global ignore patterns', () => {
      assert.strictEqual(shouldIgnore('dist/bundle.js', config), true);
      assert.strictEqual(shouldIgnore('npm.log', config), true);
    });

    it('respects validator-specific ignore patterns', () => {
      assert.strictEqual(shouldIgnore('tests/secrets.json', config, 'securityIgnore'), true);
      assert.strictEqual(shouldIgnore('tests/secrets.json', config, 'todoIgnore'), false);
    });

    it('returns false for non-ignored paths', () => {
      assert.strictEqual(shouldIgnore('src/index.js', config), false);
      assert.strictEqual(shouldIgnore('src/index.js', config, 'securityIgnore'), false);
    });

    it('handles missing config or arrays gracefully', () => {
      assert.strictEqual(shouldIgnore('foo.ts', {}), false);
      assert.strictEqual(shouldIgnore('foo.ts', { ignore: [] }), false);
    });
  });

  describe('globMatch', () => {
    it('returns false for empty inputs', () => {
      assert.strictEqual(globMatch('', []), false);
      assert.strictEqual(globMatch('foo.ts', []), false);
      assert.strictEqual(globMatch('', ['*.ts']), false);
    });

    it('matches simple patterns', () => {
      assert.strictEqual(globMatch('app.ts', ['*.ts']), true);
      assert.strictEqual(globMatch('app.js', ['*.ts']), false);
    });

    it('matches with ** wildcards', () => {
      const patterns = ['src/**/*.ts'];
      assert.strictEqual(globMatch('src/index.ts', patterns), true);
      assert.strictEqual(globMatch('src/components/button.ts', patterns), true);
      assert.strictEqual(globMatch('lib/index.ts', patterns), false);
    });

    it('matches with **/ prefix', () => {
      const patterns = ['**/__tests__/**/*.test.js'];
      assert.strictEqual(globMatch('__tests__/foo.test.js', patterns), true);
      assert.strictEqual(globMatch('src/__tests__/foo.test.js', patterns), true);
      assert.strictEqual(globMatch('src/components/__tests__/button.test.js', patterns), true);
    });

    it('ALWAYS rejects node_modules at any depth', () => {
      const patterns = ['**/*.js'];
      assert.strictEqual(globMatch('node_modules/lodash/index.js', patterns), false);
      assert.strictEqual(globMatch('src/node_modules/foo/bar.js', patterns), false);
      assert.strictEqual(globMatch('packages/app/node_modules/react/index.js', patterns), false);
    });

    it('handles multiple patterns', () => {
      const patterns = ['*.ts', '*.tsx'];
      assert.strictEqual(globMatch('app.ts', patterns), true);
      assert.strictEqual(globMatch('button.tsx', patterns), true);
      assert.strictEqual(globMatch('styles.css', patterns), false);
    });
  });
});
