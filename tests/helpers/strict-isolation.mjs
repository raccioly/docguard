/**
 * Isolating one validator in a strict fixture (specs/097 FR-003, as amended).
 *
 * Under `strict` a `validators.<key>: false` entry does not switch a validator off, so a fixture that
 * wants to look at one validator switches the others off the way an adopter does on purpose: with a
 * reasoned waiver (`docguard:validator <key> n/a — reason owner: expires:`, spec 084). The helper turns the
 * `only(...)` map the older fixtures write into those waivers in the fixture's `README.md`, and drops the
 * `false` entries, which strict would only report as not honored.
 */
export function isolateWithWaivers(files, config) {
  const mode = typeof config?.enforcement === 'string' ? config.enforcement : config?.enforcement?.mode;
  if (mode !== 'strict' || !config.validators || typeof config.validators !== 'object') return { files, config };
  const off = Object.entries(config.validators).filter(([, on]) => on === false).map(([key]) => key);
  if (off.length === 0) return { files, config };
  const waivers = off.map(key => `<!-- docguard:validator ${key} n/a — isolated for this fixture owner:@maintainers expires:2099-12-31 -->`).join('\n');
  const readme = `${files['README.md'] ?? '# Fixture\n'}\n${waivers}\n`;
  const validators = Object.fromEntries(Object.entries(config.validators).filter(([, on]) => on !== false));
  return { files: { ...files, 'README.md': readme }, config: { ...config, validators } };
}
