# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.9.x   | ✅ Current |
| < 0.9   | ❌ Not supported |

## Reporting a Vulnerability

If you discover a security vulnerability in DocGuard, please report it responsibly:

1. **Do NOT** open a public GitHub issue for security vulnerabilities
2. **Report via** [GitHub Security Advisories](https://github.com/raccioly/docguard/security/advisories/new) (private, preferred)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will acknowledge your report within 48 hours. We will then give you a timeline for a fix.

## Security Model

DocGuard is a **local CLI tool** with a minimal attack surface:

- **One exact-pinned, vetted dependency** (`@babel/parser`, loaded optionally with a regex fallback) — minimal supply-chain surface
- **No network requests** — it runs entirely offline
- **No authentication** — there are no credentials to compromise
- **No data storage** — stateless; it reads and writes project files only
- **Read-mostly** — most commands only read files. `init`, `generate`, and `hooks` write files

For more detail, see [docs-canonical/SECURITY.md](./docs-canonical/SECURITY.md).

## Best Practices for Users

- Keep Node.js updated (DocGuard requires ≥ 18)
- Review generated git hooks before you enable them (`docguard hooks`)
- Review generated documentation before you commit it
