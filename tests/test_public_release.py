from __future__ import annotations

import re
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
THIS_FILE = Path(__file__).resolve()


class PublicReleaseTests(unittest.TestCase):
    def tracked_files(self) -> list[Path]:
        result = subprocess.run(
            ["git", "ls-files"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        return [ROOT / line for line in result.stdout.splitlines() if line]

    def test_public_package_has_required_user_files(self) -> None:
        required = [
            "README.md",
            "LICENSE",
            "CHANGELOG.md",
            "SECURITY.md",
            "docs/QUICKSTART.md",
            "docs/PRIVACY.md",
            "skills/xshui-workspace-builder/SKILL.md",
        ]
        for relative in required:
            with self.subTest(relative=relative):
                self.assertTrue((ROOT / relative).is_file())

    def test_no_internal_or_private_material_is_tracked(self) -> None:
        banned_paths = ("internal/", ".private/", ".local/", "release-work/")
        for path in self.tracked_files():
            relative = path.relative_to(ROOT).as_posix()
            self.assertFalse(relative.startswith(banned_paths), relative)
            self.assertNotIn(".bak-", relative)

    def test_no_machine_paths_private_links_or_secret_shapes(self) -> None:
        fragments = [
            "/" + "Users/",
            "/" + "home/",
            "file" + ":///",
            "my" + ".feishu.cn",
            "商务" + "合作",
            "gh" + "o_",
        ]
        findings: list[str] = []
        for path in self.tracked_files():
            if path.resolve() == THIS_FILE or not path.is_file():
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            for fragment in fragments:
                if fragment in text:
                    findings.append(f"{path.relative_to(ROOT)}: {fragment}")
            if re.search(r"\bsk-[A-Za-z0-9_-]{20,}\b", text):
                findings.append(f"{path.relative_to(ROOT)}: secret-shaped sk token")
            if re.search(r"(?:access|api)[_-]?(?:token|key)\s*[:=]\s*['\"][A-Za-z0-9._-]{12,}['\"]", text, re.IGNORECASE):
                findings.append(f"{path.relative_to(ROOT)}: credential assignment")
        self.assertEqual(findings, [])


if __name__ == "__main__":
    unittest.main()
