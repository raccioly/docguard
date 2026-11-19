# Support

## Getting Help

If you have trouble with DocGuard, use these options:

### 📖 Documentation

- **[README](./README.md)** — Overview, installation, and quick start
- **[docs/](./docs/)** — Detailed guides (quickstart, configuration, commands)
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** — Development setup and contribution rules

### 🐛 Bug Reports

Found a bug? [Open a GitHub issue](https://github.com/raccioly/docguard/issues/new) with:

- DocGuard version (`docguard --version`)
- Node.js version (`node --version`)
- Your OS and version
- Steps to reproduce the issue
- Expected and actual behavior

### 💡 Feature Requests

Have an idea? [Open a GitHub issue](https://github.com/raccioly/docguard/issues/new) with the `enhancement` label.

### 💬 Questions

For general questions about CDD methodology or DocGuard usage:

1. Check the [docs/](./docs/) directory first
2. Search [existing issues](https://github.com/raccioly/docguard/issues). Someone may have asked the same question
3. Open a new issue with the `question` label

### 🔧 Self-Diagnosis

Run these commands to find common problems:

```bash
# Check DocGuard version
npx docguard --version

# Run the full diagnostic
npx docguard fix

# Check your project's CDD score
npx docguard score

# Validate all documentation
npx docguard guard
```
