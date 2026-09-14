#!/usr/bin/env python3
"""Build a spec-kit "Extension Submission" for DocGuard.

Per github/spec-kit#2707 (maintainer mnriem) and spec-kit's Extension
Publishing Guide, a community catalog add/update MUST go through the
Extension Submission issue template
(.github/ISSUE_TEMPLATE/extension_submission.yml) — NOT a direct PR editing
catalog.community.json. This script never touches the spec-kit repo; it only
prepares the submission so a human can open it through the real form (so
GitHub auto-applies the template's labels and auto-assigns a maintainer).

Two output modes:
  --url   Print a prefilled issue-form URL. Open it, review, and submit
          through the form. Checkbox groups can't be prefilled via URL, so
          tick those by hand. Large fields may be truncated by URL length
          limits — paste them from --body if so.
  --body  Print Markdown mirroring every form field (a reliable copy/paste
          source and an audit record).

The field values live in ONE place below so --url and --body never drift.
Only the version and download URL change per release.

Usage: speckit-submission.py (--url|--body) <version> <download_url>
"""
import sys
import json
from pathlib import Path
from urllib.parse import urlencode, quote

FORM_URL = "https://github.com/github/spec-kit/issues/new"
TEMPLATE = "extension_submission.yml"
MANIFEST = Path(__file__).resolve().parents[2] / "extensions/spec-kit-docguard/extension.yml"


def manifest_inventory(path: Path = MANIFEST):
    """Read command and hook names from the extension manifest without PyYAML."""
    commands, hooks = [], []
    section = subsection = None
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        content = line.lstrip()
        indent = len(line) - len(content)

        if indent == 0:
            section = content[:-1] if content.endswith(":") else None
            subsection = None
            continue

        if section == "provides":
            if indent == 2:
                subsection = content[:-1] if content.endswith(":") else None
            elif (subsection == "commands" and indent == 4
                  and content.startswith("- name:")):
                commands.append(content.split(":", 1)[1].strip().strip("\"'"))
        elif section == "hooks" and indent == 2 and content.endswith(":"):
            hooks.append(content[:-1])

    if not commands or not hooks:
        raise RuntimeError(f"Could not read commands and hooks from {path}")
    return commands, hooks


def changelog_section(version: str) -> str:
    """Pull the release's CHANGELOG section, if available."""
    try:
        with open("CHANGELOG.md", encoding="utf-8") as f:
            lines = f.readlines()
    except FileNotFoundError:
        lines = []
    out, found = [], False
    for line in lines:
        if line.startswith(f"## [{version}]"):
            found = True
            continue
        if found and line.startswith("## ["):
            break
        if found:
            out.append(line.rstrip("\n"))
    text = "\n".join(out).strip()
    if not text:
        text = (
            f"See [CHANGELOG](https://github.com/raccioly/docguard/blob/main/"
            f"CHANGELOG.md) for v{version} details."
        )
    return text


def build(version: str, download_url: str):
    commands, hooks = manifest_inventory()
    command_count, hook_count = len(commands), len(hooks)
    catalog_entry = {
        "docguard": {
            "name": "DocGuard — CDD Enforcement",
            "id": "docguard",
            "description": (
                "A documentation-integrity engine with an MCP server, "
                "SARIF/JUnit output, and a deterministic zero-LLM core. "
                "Validates, scores, and traces documentation against code — "
                "stable finding codes, adoption baseline for "
                "legacy repos, compliance-evidence reports, GitHub Action "
                "with PR annotations, spec-kit hooks. Pure Node.js, one "
                "pinned dep."
            ),
            "author": "raccioly",
            "version": version,
            "download_url": download_url,
            "repository": "https://github.com/raccioly/docguard",
            "homepage": "https://www.npmjs.com/package/docguard-cli",
            "documentation": (
                "https://github.com/raccioly/docguard/blob/main/"
                "extensions/spec-kit-docguard/README.md"
            ),
            "changelog": (
                "https://github.com/raccioly/docguard/blob/main/CHANGELOG.md"
            ),
            "license": "MIT",
            "requires": {
                "speckit_version": ">=0.1.0",
                "tools": [
                    {"name": "node", "version": ">=18.0.0", "required": True}
                ],
            },
            "provides": {"commands": command_count, "hooks": hook_count},
            "tags": [
                "documentation", "validation", "quality", "cdd",
                "traceability", "ai-agents", "enforcement", "spec-kit",
            ],
            "verified": False,
            "downloads": 0,
            "stars": 0,
        }
    }

    # (form-field-id, label, value). Order mirrors extension_submission.yml.
    # `None`-valued ids are checkbox groups: rendered in --body, omitted in --url.
    fields = [
        ("extension-id", "Extension ID", "docguard"),
        ("extension-name", "Extension Name", "DocGuard — CDD Enforcement"),
        ("version", "Version", version),
        ("description", "Description", catalog_entry["docguard"]["description"]),
        ("author", "Author", "raccioly"),
        ("repository", "Repository URL", "https://github.com/raccioly/docguard"),
        ("download-url", "Download URL", download_url),
        ("license", "License", "MIT"),
        ("homepage", "Homepage (optional)", "https://www.npmjs.com/package/docguard-cli"),
        ("documentation", "Documentation URL (optional)",
         catalog_entry["docguard"]["documentation"]),
        ("changelog", "Changelog URL (optional)",
         "https://github.com/raccioly/docguard/blob/main/CHANGELOG.md"),
        ("speckit-version", "Required Spec Kit Version", ">=0.1.0"),
        ("required-tools", "Required Tools (optional)",
         "- node (>=18.0.0) - required\n"
         "- npx - required\n"
         "- specify - optional (auto-initializes the SDD workflow during docguard init)"),
        ("commands-count", "Number of Commands", str(command_count)),
        ("hooks-count", "Number of Hooks (optional)", str(hook_count)),
        ("tags", "Tags",
         "documentation, validation, quality, cdd, traceability, ai-agents, enforcement, spec-kit"),
        ("features", "Key Features",
         "- Configurable quality gate with severity triage and a remediation plan\n"
         "- AI-driven documentation repair with codebase research and validation loops\n"
         "- Cross-document semantic consistency analysis (read-only review)\n"
         "- CDD maturity score with an ROI-based improvement roadmap\n"
         "- Reverse-engineers canonical docs from an existing codebase\n"
         f"- spec-kit workflow hooks ({', '.join(hooks)})"),
        ("testing", "Testing Checklist", None),
        ("requirements", "Submission Requirements", None),
        ("testing-details", "Testing Details",
         "**Release verification:** Record the platforms and results actually tested before submission.\n\n"
         "**Install:**\n```bash\n"
         f"specify extension add docguard --from {download_url}\n```\n\n"
         "**Scenarios to verify for this release:**\n"
         "1. Extension installs from the release ZIP without manifest validation errors.\n"
         f"2. All {command_count} declared `speckit.docguard.*` commands resolve and run.\n"
         f"3. All {hook_count} declared workflow hooks register against spec-kit's lifecycle."),
        ("example-usage", "Example Usage",
         "```bash\n"
         "# Install the extension\n"
         f"specify extension add docguard --from {download_url}\n\n"
         "# Run the documentation quality gate\n"
         "/speckit.docguard.guard\n```"),
        ("catalog-entry", "Proposed Catalog Entry",
         "```json\n" + json.dumps(catalog_entry, indent=2) + "\n```"),
        ("additional-context", "Additional Context",
         "**This is an update to an existing catalog entry (`docguard`)** for a "
         "new release — please bump the version and download URL on the current "
         "entry rather than adding a duplicate.\n\n"
         f"**Release notes (v{version}):**\n\n{changelog_section(version)}"),
    ]

    testing_items = [
        "Extension installs successfully via download URL",
        "All commands execute without errors",
        "Documentation is complete and accurate",
        "No security vulnerabilities identified",
        "Tested on at least one real project",
    ]
    requirement_items = [
        "Valid `extension.yml` manifest included",
        "README.md with installation and usage instructions",
        "LICENSE file included",
        "GitHub release created with version tag",
        "All command files exist and are properly formatted",
        "Extension ID follows naming conventions (lowercase-with-hyphens)",
    ]
    checkbox_items = {"testing": testing_items, "requirements": requirement_items}
    return fields, checkbox_items, catalog_entry


def render_body(fields, checkbox_items) -> str:
    blocks = []
    for fid, label, value in fields:
        if value is None:  # checkbox group
            ticked = "\n".join(f"- [ ] {item}" for item in checkbox_items[fid])
            blocks.append(f"### {label}\n\n{ticked}")
        else:
            blocks.append(f"### {label}\n\n{value}")
    return "\n\n".join(blocks) + "\n"


# Large free-text fields overflow GitHub's URL length limit (~8 KB) — the form
# then returns "Whoa there! Your request URL is too long." and prefills NOTHING.
# Keep these OUT of the prefilled URL; they live in the --body paste-fallback,
# which the issue surfaces in a copy/paste <details> block. The URL prefills the
# short, high-value identity fields; the human pastes the rest.
URL_OMIT = {"features", "testing-details", "example-usage",
            "catalog-entry", "additional-context"}

# Conservative cap (well under GitHub's limit) so the one-click link always loads.
URL_MAX = 6000


def render_url(fields, version) -> str:
    params = {"template": TEMPLATE,
              "title": f"[Extension]: Update DocGuard — CDD Enforcement (v{version})"}
    for fid, _label, value in fields:
        if value is None or fid in URL_OMIT:
            continue  # checkbox groups + oversized fields are paste-only
        params[fid] = value
    url = FORM_URL + "?" + urlencode(params, quote_via=quote)
    # Safety net: if still too long, shed the longest optional fields until it
    # fits. (Identity fields — id/name/version/urls — are always kept.)
    for fid in ("required-tools", "tags", "description", "documentation", "changelog"):
        if len(url) <= URL_MAX:
            break
        params.pop(fid, None)
        url = FORM_URL + "?" + urlencode(params, quote_via=quote)
    return url


def main():
    if len(sys.argv) != 4 or sys.argv[1] not in ("--url", "--body"):
        print(__doc__)
        sys.exit(1)
    mode, version, download_url = sys.argv[1], sys.argv[2], sys.argv[3]
    fields, checkbox_items, _ = build(version, download_url)
    if mode == "--body":
        sys.stdout.write(render_body(fields, checkbox_items))
    else:
        sys.stdout.write(render_url(fields, version) + "\n")


if __name__ == "__main__":
    main()
