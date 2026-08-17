from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = REPO_ROOT / "skills" / "xshui-workspace-builder" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import build_standalone  # noqa: E402
import scaffold_workbench  # noqa: E402


SAFE_TMP = Path(tempfile.gettempdir()).resolve()


def temp_root(prefix: str) -> Path:
    return Path(tempfile.mkdtemp(prefix=prefix, dir=SAFE_TMP))


def args(root: Path, name: str, *, force: bool = False) -> argparse.Namespace:
    return argparse.Namespace(
        template="xiaoshui",
        output_root=str(root),
        name=name,
        owner_name="安全测试",
        title="安全测试工作台",
        force=force,
    )


class PathSafetyTests(unittest.TestCase):
    def test_broad_and_protected_roots_rejected(self) -> None:
        candidates = [
            ".",
            "..",
            "/",
            "~",
            str(Path.home()),
            str(Path.cwd()),
            str(scaffold_workbench.REPO_ROOT),
            str(scaffold_workbench.REPO_ROOT.parent),
            str(scaffold_workbench.SKILL_DIR),
            str(scaffold_workbench.TEMPLATE_ROOT),
        ]
        for candidate in candidates:
            with self.subTest(candidate=candidate), self.assertRaises(ValueError):
                scaffold_workbench.validate_output_root(candidate)

    def test_relative_traversal_rejected_before_write(self) -> None:
        with self.assertRaises(ValueError):
            scaffold_workbench.validate_output_root("../outside")

    def test_symlink_root_rejected(self) -> None:
        root = temp_root("xshui-safety-link-")
        real = root / "real"
        real.mkdir()
        link = root / "linked"
        link.symlink_to(real, target_is_directory=True)
        with self.assertRaises(ValueError):
            scaffold_workbench.validate_output_root(str(link))

    def test_non_owned_directory_survives_force(self) -> None:
        root = temp_root("xshui-safety-owned-")
        target = root / "existing"
        target.mkdir()
        sentinel = target / "user-file.txt"
        sentinel.write_text("keep-me", encoding="utf-8")
        with self.assertRaises(ValueError):
            scaffold_workbench.scaffold(args(root, "existing", force=True))
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep-me")

    def test_forged_marker_does_not_authorize_force(self) -> None:
        root = temp_root("xshui-safety-marker-")
        target = root / "existing"
        target.mkdir()
        (target / scaffold_workbench.MARKER).write_text("{}", encoding="utf-8")
        sentinel = target / "user-file.txt"
        sentinel.write_text("keep-me", encoding="utf-8")
        with self.assertRaises(ValueError):
            scaffold_workbench.scaffold(args(root, "existing", force=True))
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep-me")

    def test_valid_generation_and_owned_force(self) -> None:
        root = temp_root("xshui-safety-valid-")
        target = scaffold_workbench.scaffold(args(root, "valid"))
        sentinel = target / "old-version.txt"
        sentinel.write_text("old", encoding="utf-8")
        regenerated = scaffold_workbench.scaffold(args(root, "valid", force=True))
        self.assertTrue((regenerated / "dist" / "index.html").is_file())
        self.assertFalse((regenerated / "old-version.txt").exists())
        backups = list(root.glob(".valid.bak-*"))
        self.assertEqual(len(backups), 1)
        self.assertEqual((backups[0] / "old-version.txt").read_text(encoding="utf-8"), "old")

    def test_atomic_replace_failure_rolls_back_old_output(self) -> None:
        root = temp_root("xshui-safety-rollback-")
        target = scaffold_workbench.scaffold(args(root, "rollback"))
        sentinel = target / "old-version.txt"
        sentinel.write_text("old", encoding="utf-8")
        real_replace = os.replace
        failed = False

        def controlled_replace(source: os.PathLike[str] | str, destination: os.PathLike[str] | str) -> None:
            nonlocal failed
            source_path = Path(source)
            destination_path = Path(destination)
            if not failed and source_path.name.startswith(".rollback.staging-") and destination_path == target:
                failed = True
                raise OSError("simulated final replace failure")
            real_replace(source, destination)

        with mock.patch.object(scaffold_workbench.os, "replace", side_effect=controlled_replace):
            with self.assertRaises(OSError):
                scaffold_workbench.scaffold(args(root, "rollback", force=True))
        self.assertTrue(target.is_dir())
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "old")

    def test_standalone_builder_rejects_relative_and_bad_marker(self) -> None:
        with self.assertRaises(ValueError):
            build_standalone.validate_project(Path("."))
        root = temp_root("xshui-safety-build-")
        project = root / "fake"
        (project / "src").mkdir(parents=True)
        (project / "dist").mkdir()
        (project / build_standalone.MARKER).write_text(json.dumps({"tool": "someone-else", "version": 1, "createdAt": "now"}), encoding="utf-8")
        with self.assertRaises(ValueError):
            build_standalone.validate_project(project)


if __name__ == "__main__":
    unittest.main()
