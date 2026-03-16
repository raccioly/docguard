/**
 * Ensure Skills — Silent auto-check for DocGuard AI skills and commands
 *
 * Called before every command execution. If skills or commands are missing,
 * copies them from the package's bundled assets into the project directory.
 *
 * Zero dependencies — pure Node.js built-ins only.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, cpSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { c } from './shared.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Source locations in the npm package
const SKILLS_SOURCE = resolve(__dirname, '..', 'extensions', 'spec-kit-docguard', 'skills');
const COMMANDS_SOURCE = resolve(__dirname, '..', 'commands');

// Destination in the user's project
const SKILLS_DEST = '.agent/skills';
const COMMANDS_DEST = 'commands';

/**
 * Silently ensure skills and commands are installed in the project.
 *
 * @param {string} projectDir - The project root directory
 * @param {object} flags - CLI flags (format, etc.)
 * @returns {{ skillsInstalled: boolean, commandsInstalled: boolean }}
 */
export function ensureSkills(projectDir, flags = {}) {
  const result = { skillsInstalled: false, commandsInstalled: false };
  const silent = flags.format === 'json';

  // ── Skills ────────────────────────────────────────────────────────────
  const skillsCheck = resolve(projectDir, SKILLS_DEST, 'docguard-guard', 'SKILL.md');
  if (!existsSync(skillsCheck) && existsSync(SKILLS_SOURCE)) {
    try {
      const skillDirs = readdirSync(SKILLS_SOURCE).filter(d =>
        existsSync(resolve(SKILLS_SOURCE, d, 'SKILL.md'))
      );

      for (const skillDir of skillDirs) {
        const destDir = resolve(projectDir, SKILLS_DEST, skillDir);
        if (!existsSync(destDir)) {
          mkdirSync(destDir, { recursive: true });
        }
        const srcSkill = resolve(SKILLS_SOURCE, skillDir, 'SKILL.md');
        const destSkill = resolve(destDir, 'SKILL.md');
        if (!existsSync(destSkill)) {
          writeFileSync(destSkill, readFileSync(srcSkill, 'utf-8'), 'utf-8');
        }
      }

      result.skillsInstalled = true;
      if (!silent) {
        console.log(`  ${c.cyan}✨ DocGuard AI skills installed → ${SKILLS_DEST}/${c.reset}`);
      }
    } catch {
      // Silent failure — skills are optional enhancement
    }
  }

  // ── Slash Commands ────────────────────────────────────────────────────
  const commandsCheck = resolve(projectDir, COMMANDS_DEST, 'docguard.guard.md');
  if (!existsSync(commandsCheck) && existsSync(COMMANDS_SOURCE)) {
    try {
      const commandFiles = readdirSync(COMMANDS_SOURCE).filter(f => f.endsWith('.md'));

      if (commandFiles.length > 0) {
        const destDir = resolve(projectDir, COMMANDS_DEST);
        if (!existsSync(destDir)) {
          mkdirSync(destDir, { recursive: true });
        }

        for (const file of commandFiles) {
          const destPath = resolve(destDir, file);
          if (!existsSync(destPath)) {
            writeFileSync(destPath, readFileSync(resolve(COMMANDS_SOURCE, file), 'utf-8'), 'utf-8');
          }
        }

        result.commandsInstalled = true;
        if (!silent) {
          console.log(`  ${c.cyan}✨ DocGuard slash commands installed → ${COMMANDS_DEST}/${c.reset}`);
        }
      }
    } catch {
      // Silent failure — commands are optional enhancement
    }
  }

  return result;
}
