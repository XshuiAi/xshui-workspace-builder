from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills" / "xshui-workspace-builder"


class ProjectContractTests(unittest.TestCase):
    def test_three_templates_share_runtime_contract(self) -> None:
        expected = {"xiaoshui", "admin-minimal", "student-campus"}
        found = set()
        for path in (SKILL / "assets" / "templates").glob("*/template.json"):
            config = json.loads(path.read_text(encoding="utf-8"))
            found.add(config["templateId"])
            self.assertTrue(config["modules"])
            self.assertTrue(any(item.get("archive") for item in config["modules"]))
            self.assertTrue(any(item.get("protected") for item in config["modules"]))
            for module in config["modules"]:
                self.assertIn("collection", module)
                self.assertIn("fields", module)
        self.assertEqual(found, expected)

    def test_runtime_contains_required_behaviors(self) -> None:
        storage = (SKILL / "runtime" / "storage.js").read_text(encoding="utf-8")
        backup = (SKILL / "runtime" / "backup.js").read_text(encoding="utf-8")
        editor = (SKILL / "runtime" / "editor.js").read_text(encoding="utf-8")
        app = (SKILL / "runtime" / "app.js").read_text(encoding="utf-8")
        self.assertIn("indexedDB.open", storage)
        self.assertIn("xshui-workspace-backup", backup)
        self.assertIn("最多撤销 20 步", editor)
        self.assertIn("hideAction", editor)
        self.assertIn("data-image-slot", app)
        self.assertIn("完整恢复前自动快照", app)
        self.assertNotIn("hero-line-stage", app)


if __name__ == "__main__":
    unittest.main()
