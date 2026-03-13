# Support

## Getting Help

If you're having trouble with SpecGuard, here's how to get help:

### 📖 Documentation

- **[README](./README.md)** — Overview, installation, and quick start
- **[docs/](./docs/)** — Detailed guides (quickstart, configuration, commands)
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** — Development setup and contribution guidelines

### 🐛 Bug Reports

Found a bug? [Open a GitHub issue](https://github.com/raccioly/specguard/issues/new) with:

- SpecGuard version (`specguard --version`)
- Node.js version (`node --version`)
- Your OS and version
- Steps to reproduce the issue
- Expected vs actual behavior

### 💡 Feature Requests

Have an idea? [Open a GitHub issue](https://github.com/raccioly/specguard/issues/new) with the `enhancement` label.

### 💬 Questions

For general questions about CDD methodology or SpecGuard usage:

1. Check the [docs/](./docs/) directory first
2. Search [existing issues](https://github.com/raccioly/specguard/issues) — someone may have asked the same question
3. Open a new issue with the `question` label

### 🔧 Self-Diagnosis

Run these commands to diagnose common issues:

```bash
# Check SpecGuard version
npx specguard --version

# Run the full diagnostic
npx specguard fix

# Check your project's CDD score
npx specguard score

# Validate all documentation
npx specguard guard
```
