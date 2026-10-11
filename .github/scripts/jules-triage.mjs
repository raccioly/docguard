/**
 * API glue for .github/workflows/jules-triage.yml. Every decision is made by
 * jules-policy.mjs; this only gathers its inputs and carries out its answer.
 *
 * Runs under pull_request_target (write scope) from the default branch. It
 * reads PR metadata through the API and never checks out or executes PR code.
 *
 * Comments never name the agent by its handle: with Jules' Reactive Mode on, a
 * mention is an instruction, and a closed PR is not one to act on.
 *
 * @implements docguard.jules-policy#FR-004
 * @implements docguard.jules-policy#FR-005
 * @implements docguard.jules-policy#FR-007
 */
import { DECLINE_WINDOW_DAYS, LABELS, QUEUE_CAP, isJules, triage } from './jules-policy.mjs';

const MARKER = '<!-- docguard-jules:triage -->';
const COLORS = {
  [LABELS.noise]: 'CCCCCC', [LABELS.duplicate]: 'CCCCCC', [LABELS.declined]: 'CCCCCC', [LABELS.offContract]: 'CCCCCC',
  [LABELS.queueFull]: 'FBCA04', [LABELS.review]: 'B60205', [LABELS.eligible]: '0E8A16',
};

export async function run({ github, context, core, now = new Date().toISOString() }) {
  const { owner, repo } = context.repo;
  const number = context.payload.pull_request.number;
  const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: number });
  if (!isJules(pr.user?.login) || pr.state !== 'open') { core.info(`#${number}: not an open Jules PR`); return; }

  // Every page: GitHub returns at most 100 files per request.
  const filesOf = async (n) => (await github.paginate(github.rest.pulls.listFiles, { owner, repo, pull_number: n, per_page: 100 }))
    .map((f) => ({ filename: f.filename, status: f.status, previous_filename: f.previous_filename }));
  const shape = async (p) => ({
    number: p.number, title: p.title, labels: p.labels, mergedAt: p.merged_at, closedAt: p.closed_at,
    files: (await filesOf(p.number)).map((f) => f.filename),
  });

  const openJules = (await github.paginate(github.rest.pulls.list, { owner, repo, state: 'open', per_page: 100 }))
    .filter((p) => isJules(p.user?.login) && p.number !== number);

  // Closed PRs newest-updated first, paging until a page reaches past the
  // window: a PR closed inside it was also updated inside it.
  const cutoff = Date.parse(now) - DECLINE_WINDOW_DAYS * 86_400_000;
  const recent = await github.paginate(
    github.rest.pulls.list,
    { owner, repo, state: 'closed', sort: 'updated', direction: 'desc', per_page: 100 },
    (response, done) => {
      if (response.data.some((p) => Date.parse(p.updated_at) < cutoff)) done();
      return response.data;
    },
  );
  const closedJules = recent.filter((p) => isJules(p.user?.login) && p.closed_at && Date.parse(p.closed_at) >= cutoff);

  const decision = triage({
    pr: { number, title: pr.title, files: await filesOf(number) },
    open: await Promise.all(openJules.map(shape)),
    closed: await Promise.all(closedJules.map(shape)),
    now,
  });
  core.info(`#${number}: ${decision.action} (${decision.label}): ${decision.reason}`);

  await github.rest.issues.createLabel({ owner, repo, name: decision.label, color: COLORS[decision.label] ?? 'CCCCCC' }).catch(() => {});
  await github.rest.issues.addLabels({ owner, repo, issue_number: number, labels: [decision.label] });

  if (decision.action === 'close') {
    await github.rest.issues.createComment({
      owner, repo, issue_number: number,
      body: `${MARKER}\n**Closed automatically:** ${decision.reason}.\n\n`
        + 'Jules PRs on this repository follow `.github/scripts/jules-policy.mjs` and the **Automated agents** '
        + 'section of `AGENTS.md`: one PR per routine target, a target is not proposed again while it is open or '
        + `for ${DECLINE_WINDOW_DAYS} days after it was declined, and at most ${QUEUE_CAP} wait for review at once. `
        + 'A maintainer can reopen this if the policy got it wrong.',
    });
    await github.rest.pulls.update({ owner, repo, pull_number: number, state: 'closed' });
    return;
  }
  await github.rest.issues.createComment({
    owner, repo, issue_number: number,
    body: decision.label === LABELS.eligible
      ? `${MARKER}\n**Eligible to merge on green CI:** ${decision.reason}. The auto-merge workflow re-checks the exact head commit before it merges.`
      : `${MARKER}\n**Needs a maintainer:** ${decision.reason}. CI still runs; nothing here merges without a person.`,
  });
}
