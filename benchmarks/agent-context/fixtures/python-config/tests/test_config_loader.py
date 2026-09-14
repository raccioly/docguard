import json
import tempfile
import unittest
from pathlib import Path

from config_loader import load_config


class ConfigLoaderTests(unittest.TestCase):
    def test_loads_top_level_object_and_rejects_array(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "app.json").write_text(json.dumps({"mode": "safe"}), encoding="utf-8")
            (root / "array.json").write_text("[]", encoding="utf-8")
            self.assertEqual(load_config(root, "app.json"), {"mode": "safe"})
            with self.assertRaises(ValueError):
                load_config(root, "array.json")


if __name__ == "__main__":
    unittest.main()
