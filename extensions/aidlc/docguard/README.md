# DocGuard plugin for AWS AI-DLC

Runs [DocGuard](https://github.com/raccioly/docguard) inside an
[AI-DLC](https://github.com/awslabs/aidlc-workflows) workflow:
- a `docguard-guard` sensor at the code-generation and build-and-test gates;
- a developer-agent guide.

DocGuard also reads AI-DLC workspaces on its own (`docguard guard`): AID001 to
AID004 and MEM001 to MEM002.

## Install

1. Install DocGuard so the sensor can run it: `npm install -g docguard-cli`.
2. Build the plugin for your harness with AI-DLC's own builder, from this
   folder, naming a project where AI-DLC is configured:
   `AIDLC_PROJECT_DIR=/path/to/project aidlc engine plugin build claude ./dist`.
3. Add the catalogue and install through your host. For Claude Code:
   `/plugin marketplace add ./dist` then `/plugin install docguard@docguard-aidlc`.
   AI-DLC composes it on the next session (`aidlc engine plugin list` shows it).

The sensor passes when the work in progress introduced no drift. Concretely,
there is no blocking finding and no finding the HEAD commit did not already
have. Existing warnings don't fail your gates; drift a stage writes does.

The sensor is advisory, like AI-DLC's own. Make it blocking in your scope if your
team wants DocGuard to hold the gate.
