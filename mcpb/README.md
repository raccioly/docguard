# MCPB bundle (Claude Desktop one-click extension)

`manifest.template.json` is the source for the `.mcpb` Desktop Extension —
`__VERSION__` is substituted by the release workflow's `build-mcpb` job, which
stages the npm package (plus its one production dependency), packs it with
`@anthropic-ai/mcpb`, and attaches `docguard.mcpb` to the GitHub Release.

The mcpb schema is strict: no `$comment`/unknown keys in the manifest.
Spec: <https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md>

Users install by dragging `docguard.mcpb` into Claude Desktop →
Settings → Extensions (they'll be asked to pick the project folder DocGuard
analyzes). Directory listing is curated by Anthropic — submission interest
form is linked from <https://claude.com/docs/connectors/building/mcpb>.
