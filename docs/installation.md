# Installation

## Requirements

- **Node.js** ≥ 18
- **git** (optional — needed for freshness validation)

## Install via npx (Recommended)

No installation needed. Run directly:

```bash
npx docguard --help
```

This downloads and runs DocGuard on demand. Always uses the latest version.

## Install as Dev Dependency

For projects that want a pinned version:

```bash
npm install --save-dev docguard
```

Then use via npm scripts in `package.json`:

```json
{
  "scripts": {
    "guard": "docguard guard",
    "score": "docguard score",
    "lint:docs": "docguard ci --threshold 70"
  }
}
```

## Install Globally

```bash
npm install -g docguard
```

Then use anywhere:

```bash
docguard guard
docguard score
```

## Verify Installation

```bash
npx docguard --version
```

Should output `DocGuard v0.4.0` (or current version).

## CI/CD Installation

In GitHub Actions or similar:

```yaml
- name: Run DocGuard
  run: npx docguard ci --threshold 70
```

No separate install step needed — `npx` handles it.

## Upgrading

```bash
# If installed as dev dependency
npm update docguard

# If installed globally
npm update -g docguard

# If using npx — always runs latest automatically
npx docguard@latest --version
```
