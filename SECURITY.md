# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.4.x   | ✅ Current |
| < 0.4   | ❌ Not supported |

## Reporting a Vulnerability

If you discover a security vulnerability in DocGuard, please report it responsibly:

1. **Do NOT** open a public GitHub issue for security vulnerabilities
2. **Email** the maintainers directly (see repository contact info)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will acknowledge your report within 48 hours and provide a timeline for a fix.

## Security Model

DocGuard is a **local CLI tool** with a minimal attack surface:

- **Zero npm dependencies** — no supply chain risk
- **No network requests** — runs entirely offline
- **No authentication** — no credentials to compromise
- **No data storage** — stateless, reads/writes project files only
- **Read-mostly** — most commands only read files; `init`, `generate`, and `hooks` write files

For full details, see [docs-canonical/SECURITY.md](./docs-canonical/SECURITY.md).

## Best Practices for Users

- Keep Node.js updated (DocGuard requires ≥ 18)
- Review generated git hooks before enabling (`docguard hooks`)
- Review generated documentation before committing
