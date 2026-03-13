# Installation

## Requirements

- **Node.js** ≥ 18
- **git** (optional — needed for freshness validation)

## Install via npx (Recommended)

No installation needed. Run directly:

```bash
npx specguard --help
```

This downloads and runs SpecGuard on demand. Always uses the latest version.

## Install as Dev Dependency

For projects that want a pinned version:

```bash
npm install --save-dev specguard
```

Then use via npm scripts in `package.json`:

```json
{
  "scripts": {
    "guard": "specguard guard",
    "score": "specguard score",
    "lint:docs": "specguard ci --threshold 70"
  }
}
```

## Install Globally

```bash
npm install -g specguard
```

Then use anywhere:

```bash
specguard guard
specguard score
```

## Verify Installation

```bash
npx specguard --version
```

Should output `SpecGuard v0.4.0` (or current version).

## CI/CD Installation

In GitHub Actions or similar:

```yaml
- name: Run SpecGuard
  run: npx specguard ci --threshold 70
```

No separate install step needed — `npx` handles it.

## Upgrading

```bash
# If installed as dev dependency
npm update specguard

# If installed globally
npm update -g specguard

# If using npx — always runs latest automatically
npx specguard@latest --version
```
