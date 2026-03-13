/**
 * Badge Command — Generate shields.io badge URLs and markdown for CDD score
 * Outputs badge markdown or JSON for README, CI, and dashboards.
 */

import { c } from '../docguard.mjs';
import { runScoreInternal } from './score.mjs';

export function runBadge(projectDir, config, flags) {
  console.log(`${c.bold}🏷️  DocGuard Badge — ${config.projectName}${c.reset}`);
  console.log(`${c.dim}   Directory: ${projectDir}${c.reset}\n`);

  // Get score internally
  const scoreData = runScoreInternal(projectDir, config);
  const score = scoreData.score;
  const grade = scoreData.grade;

  // Determine badge color
  let color;
  if (score >= 90) color = 'brightgreen';
  else if (score >= 80) color = 'green';
  else if (score >= 70) color = 'yellowgreen';
  else if (score >= 60) color = 'yellow';
  else if (score >= 50) color = 'orange';
  else color = 'red';

  // Shields.io badge URL
  const badgeUrl = `https://img.shields.io/badge/CDD_Score-${score}%2F100_(${grade})-${color}`;
  const badgeMarkdown = `![CDD Score](${badgeUrl})`;

  // Separate badge for project type
  const projectType = config.projectType || 'unknown';
  const typeBadgeUrl = `https://img.shields.io/badge/type-${projectType}-blue`;
  const typeBadgeMarkdown = `![Type](${typeBadgeUrl})`;

  // DocGuard badge
  const sgBadgeUrl = `https://img.shields.io/badge/guarded_by-DocGuard-cyan`;
  const sgBadgeMarkdown = `![DocGuard](${sgBadgeUrl})`;

  if (flags.format === 'json') {
    const result = {
      score,
      grade,
      color,
      projectType,
      badges: {
        score: { url: badgeUrl, markdown: badgeMarkdown },
        type: { url: typeBadgeUrl, markdown: typeBadgeMarkdown },
        docguard: { url: sgBadgeUrl, markdown: sgBadgeMarkdown },
      },
      readmeSnippet: `${badgeMarkdown} ${typeBadgeMarkdown} ${sgBadgeMarkdown}`,
    };
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Display badges
  console.log(`  ${c.bold}Score Badge:${c.reset}`);
  console.log(`    ${c.cyan}${badgeMarkdown}${c.reset}\n`);

  console.log(`  ${c.bold}Type Badge:${c.reset}`);
  console.log(`    ${c.cyan}${typeBadgeMarkdown}${c.reset}\n`);

  console.log(`  ${c.bold}DocGuard Badge:${c.reset}`);
  console.log(`    ${c.cyan}${sgBadgeMarkdown}${c.reset}\n`);

  console.log(`  ${c.bold}README snippet:${c.reset}`);
  console.log(`    ${c.dim}Add this to the top of your README.md:${c.reset}\n`);
  console.log(`    ${badgeMarkdown} ${typeBadgeMarkdown} ${sgBadgeMarkdown}`);

  console.log('');
}
