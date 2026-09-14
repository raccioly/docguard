import json
import os
import sys
import tempfile
from pathlib import Path

root = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(root))
from config_loader import load_config

checks = []

def check(name, function):
    try:
        function()
        checks.append((name, True))
    except Exception:
        checks.append((name, False))

def expect_error(function):
    try:
        function()
    except (ValueError, OSError, json.JSONDecodeError):
        return
    raise AssertionError("expected a safe rejection")

with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as outside_directory:
    base = Path(directory)
    outside = Path(outside_directory)
    (base / "top.json").write_text('{"top": true}', encoding="utf-8")
    (base / "env").mkdir()
    (base / "env" / "dev.json").write_text('{"nested": true}', encoding="utf-8")
    (base / "array.json").write_text("[]", encoding="utf-8")
    (base / "bad.json").write_text("{", encoding="utf-8")
    (base / "large.json").write_text('{"value":"' + ('x' * 65537) + '"}', encoding="utf-8")
    (outside / "secret.json").write_text('{"secret": true}', encoding="utf-8")
    os.symlink(outside / "secret.json", base / "linked.json")
    check("top-level behavior remains stable", lambda: load_config(base, "top.json") == {"top": True} or (_ for _ in ()).throw(AssertionError()))
    check("nested relative path loads", lambda: load_config(base, "env/dev.json") == {"nested": True} or (_ for _ in ()).throw(AssertionError()))
    check("absolute path rejected", lambda: expect_error(lambda: load_config(base, str(outside / "secret.json"))))
    check("traversal rejected", lambda: expect_error(lambda: load_config(base, "../secret.json")))
    check("symlink escape rejected", lambda: expect_error(lambda: load_config(base, "linked.json")))
    check("oversized file rejected", lambda: expect_error(lambda: load_config(base, "large.json")))
    check("invalid JSON rejected", lambda: expect_error(lambda: load_config(base, "bad.json")))
    check("non-object root rejected", lambda: expect_error(lambda: load_config(base, "array.json")))

failures = [name for name, passed in checks if not passed]
print(json.dumps({"total": len(checks), "passed": len(checks) - len(failures), "failures": failures}))
raise SystemExit(1 if failures else 0)
