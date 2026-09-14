import json
from pathlib import Path

MAX_CONFIG_BYTES = 65_536


def load_config(base_dir, relative_path):
    if not isinstance(relative_path, str):
        raise ValueError("configuration path must be text")
    relative = Path(relative_path)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("configuration path must stay beneath base_dir")
    base = Path(base_dir).resolve(strict=True)
    target = (base / relative).resolve(strict=True)
    if not target.is_relative_to(base) or not target.is_file():
        raise ValueError("configuration path escapes base_dir")
    if target.stat().st_size > MAX_CONFIG_BYTES:
        raise ValueError("configuration file exceeds 64 KiB")
    with target.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError("configuration root must be an object")
    return value
