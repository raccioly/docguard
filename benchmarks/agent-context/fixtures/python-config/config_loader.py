import json
from pathlib import Path


def load_config(base_dir, relative_path):
    if not isinstance(relative_path, str) or "/" in relative_path or "\\" in relative_path:
        raise ValueError("configuration name must be a top-level relative path")
    target = Path(base_dir) / relative_path
    with target.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError("configuration root must be an object")
    return value
