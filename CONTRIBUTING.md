# Contributing to SpecGuard

Thank you for your interest in contributing to SpecGuard! Whether you're a developer, technical writer, or documentation enthusiast — there's a place for you here.

---

## Ways to Contribute

### 📝 Documentation
- Improve `STANDARD.md` with clearer examples
- Add stack-specific guides (Django, Spring Boot, etc.)
- Translate documentation to other languages

### 🔧 Code
- Add new validators
- Improve existing validators
- Add framework detection (auto-detect stack in generate mode)
- Create stack-specific configurations

### 🧪 Testing
- Test SpecGuard against your own projects
- Report edge cases and false positives
- Add automated tests for validators

### 💡 Ideas
- Open an issue to discuss new features
- Share how you use CDD in your workflow
- Suggest integrations with other tools

---

## Getting Started

```bash
# Clone the repo
git clone https://github.com/raccioly/specguard.git
cd specguard

# No install needed — zero dependencies!

# Run the CLI
node cli/specguard.mjs --help

# Test against itself
node cli/specguard.mjs audit
node cli/specguard.mjs guard --verbose
```

---

## Development Workflow

This project follows **Canonical-Driven Development** (we eat our own dog food 🐕):

1. **Research first** — Check `docs-canonical/` before suggesting changes
2. **Open an issue** — Describe what you want to change and why
3. **Fork & branch** — `feature/your-feature` or `fix/your-fix`
4. **Write code** — Match existing style, add `// DRIFT:` if deviating from docs
5. **Test** — Run `node cli/specguard.mjs guard` and ensure it passes
6. **PR** — Reference the issue, describe changes, update CHANGELOG.md

---

## Code Style

- **Zero dependencies** — Don't add npm packages. Use Node.js built-in modules only.
- **ESM modules** — Use `import/export`, not `require`
- **Pure functions** — Validators should be pure: take dir + config, return results
- **ANSI colors** — Use the `c` helper from `specguard.mjs` for terminal colors

---

## Validator Structure

Each validator follows this pattern:

```javascript
// cli/validators/your-validator.mjs

export function validateYourThing(projectDir, config) {
  const results = {
    name: 'your-thing',
    errors: [],    // Hard failures (exit code 1)
    warnings: [],  // Soft warnings (exit code 2)
    passed: 0,
    total: 0,
  };

  // Your validation logic here

  return results;
}
```

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
