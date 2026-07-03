# DocGuard MCP server image.
#
# Primarily consumed by MCP directory inspectors (Glama et al.) that build the
# repo and check the server starts and answers introspection over stdio. Also
# usable directly:
#
#   docker build -t docguard-mcp .
#   docker run -i --rm -v "$PWD":/workspace docguard-mcp
#
# The server is read-only; mount the project to inspect at /workspace and pass
# {"projectDir": "/workspace"} in tool calls (or rely on the default cwd).

FROM node:20-alpine

WORKDIR /app

# One pinned runtime dependency (@babel/parser) — install from the lockfile.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

WORKDIR /workspace

# stdio transport: stdout is the JSON-RPC channel.
ENTRYPOINT ["node", "/app/cli/docguard.mjs", "mcp"]
