const { execSync } = require('child_process');

try {
  const result = execSync('node --test tests/v020-consolidation.test.mjs', { encoding: 'utf-8' });
  console.log(result);
} catch (e) {
  console.error("FAILED");
  console.error(e.stdout);
  console.error(e.stderr);
}
