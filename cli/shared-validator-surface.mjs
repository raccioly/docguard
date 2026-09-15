/**
 * Validator Surface — package capability facts shared by self-governance
 * validators. A validator module is one shipped `cli/validators/*.mjs` file;
 * guard may emit additional check results from a module, but those are not
 * extra public validator modules.
 */

import { readdirSync } from 'node:fs';

/** Return the number of validator modules in one package directory, or null. */
export function countValidatorModules(validatorsDir) {
  try {
    return readdirSync(validatorsDir).filter(name => name.endsWith('.mjs')).length;
  } catch {
    return null;
  }
}
