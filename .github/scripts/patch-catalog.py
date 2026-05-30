#!/usr/bin/env python3
"""Surgical catalog.community.json patcher for DocGuard.

Updates ONLY the docguard entry and top-level updated_at.
Does NOT re-serialize the entire JSON (preserves unicode escapes,
formatting, and other extensions' entries exactly as-is).

Usage: python3 patch-catalog.py <version> <download_url> <updated_at>
"""
import sys
import json

if len(sys.argv) != 4:
    print("Usage: patch-catalog.py <version> <download_url> <updated_at>")
    sys.exit(1)

version = sys.argv[1]
download_url = sys.argv[2]
updated_at = sys.argv[3]

CATALOG_FILE = "extensions/catalog.community.json"

with open(CATALOG_FILE, "r") as f:
    content = f.read()

# Parse to validate structure and get current values
data = json.loads(content)

if "extensions" not in data or "docguard" not in data["extensions"]:
    print("❌ DocGuard entry not found in catalog.extensions")
    sys.exit(1)

dg = data["extensions"]["docguard"]
old_version = dg["version"]
old_url = dg["download_url"]
old_entry_updated = dg["updated_at"]
old_desc = dg["description"]
top_updated = data["updated_at"]

# Correct description (matches our constitution: minimal, vetted dependencies)
new_desc = (
    "Canonical-Driven Development enforcement. "
    "Validates, scores, and traces project documentation with automated checks, "
    "AI-driven workflows, and spec-kit hooks. One pinned runtime dependency; pure Node.js otherwise."
)

# Surgical string replacements — only touch specific values
# 1. DocGuard version (first occurrence after "docguard" block)
content = content.replace(
    f'"version": "{old_version}"',
    f'"version": "{version}"',
    1,
)

# 2. Download URL (unique string, safe to replace globally)
content = content.replace(old_url, download_url)

# 3. DocGuard updated_at (first occurrence after version change)
content = content.replace(
    f'"updated_at": "{old_entry_updated}"',
    f'"updated_at": "{updated_at}"',
    1,
)

# 4. Description fix (if needed)
if old_desc != new_desc:
    content = content.replace(old_desc, new_desc)

# 5. Bump top-level updated_at (should appear early in file)
content = content.replace(
    f'"updated_at": "{top_updated}"',
    f'"updated_at": "{updated_at}"',
    1,
)

with open(CATALOG_FILE, "w") as f:
    f.write(content)

print(f"✅ Updated catalog.community.json → v{version} (surgical, no noisy diffs)")
print(f"   version: {old_version} → {version}")
print(f"   download_url: updated")
print(f"   updated_at: {old_entry_updated} → {updated_at}")
print(f"   top-level updated_at: {top_updated} → {updated_at}")
if old_desc != new_desc:
    print(f"   description: updated to match constitution")

# --- Also patch extensions/README.md (table row description) ---
README_FILE = "extensions/README.md"
try:
    with open(README_FILE, "r") as f:
        readme = f.read()

    # The DocGuard row in the README table looks like:
    # | DocGuard — CDD Enforcement | <description> | [spec-kit-docguard](...) |
    # Only update if the old description is present
    if old_desc in readme and old_desc != new_desc:
        readme = readme.replace(old_desc, new_desc)
        with open(README_FILE, "w") as f:
            f.write(readme)
        print(f"✅ Updated extensions/README.md — description synced")
    else:
        print(f"ℹ️  extensions/README.md already up to date")
except FileNotFoundError:
    print(f"⚠️  {README_FILE} not found — skipping README update")
