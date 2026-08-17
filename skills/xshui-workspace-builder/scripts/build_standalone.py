#!/usr/bin/env python3
"""Build one self-contained HTML file from a generated XShui workspace."""

from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path

MARKER = ".xshui-workspace-output"
SCRIPT_ORDER = ("storage.js", "backup.js", "editor.js", "app.js")
SKILL_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = SKILL_DIR.parents[1]


def has_symlink_component(path: Path) -> bool:
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current = current / part
        if current.exists() and current.is_symlink():
            return True
    return False


def is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def validate_project(project_dir: Path) -> Path:
    raw = str(project_dir)
    if raw in {".", "..", "/", "~"} or not project_dir.is_absolute() or ".." in project_dir.parts:
        raise ValueError("工作台目录必须是经过确认的绝对专用目录")
    if has_symlink_component(project_dir):
        raise ValueError("工作台目录不能包含符号链接")
    project = project_dir.resolve(strict=False)
    protected = {Path("/").resolve(), Path.home().resolve(), Path.cwd().resolve(), REPO_ROOT.resolve(), SKILL_DIR.resolve()}
    if project in protected or any(is_relative_to(item, project) for item in (REPO_ROOT.resolve(), SKILL_DIR.resolve())):
        raise ValueError("不能把根目录、Home、当前目录、仓库根或 Skill 根作为工作台目录")
    marker = project / MARKER
    if not project.is_dir() or not marker.is_file() or marker.is_symlink():
        raise ValueError("目标不是 XShui 脚手架生成的工作台目录")
    try:
        ownership = json.loads(marker.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise ValueError(f"输出归属标记无效：{exc}") from exc
    if ownership.get("tool") != "xshui-workspace-builder" or ownership.get("version") != 1 or not ownership.get("createdAt"):
        raise ValueError("输出归属标记不属于当前工具")
    src = project / "src"
    dist = project / "dist"
    if src.is_symlink() or dist.is_symlink() or not src.is_dir() or not dist.is_dir():
        raise ValueError("src/dist 必须是工作台内部的真实目录")
    required = [src / "index.html", src / "styles.css", src / "template.json", *[src / name for name in SCRIPT_ORDER]]
    missing = [str(path) for path in required if not path.is_file() or path.is_symlink() or not is_relative_to(path.resolve(), src.resolve())]
    if missing:
        raise ValueError(f"缺少源文件：{', '.join(missing)}")
    return project


def build(project_dir: Path) -> Path:
    project = validate_project(project_dir)
    src = project / "src"
    html = (src / "index.html").read_text(encoding="utf-8")
    css = (src / "styles.css").read_text(encoding="utf-8")
    config = json.loads((src / "template.json").read_text(encoding="utf-8"))
    html = html.replace('<link rel="stylesheet" href="styles.css">', f"<style>\n{css}\n</style>")
    for script_name in SCRIPT_ORDER:
        script = (src / script_name).read_text(encoding="utf-8")
        html = html.replace(f'<script src="{script_name}"></script>', f"<script>\n{script}\n</script>")
    if re.search(r'<(?:script|link)[^>]+(?:src|href)="[^\"]+\.(?:js|css)"', html):
        raise ValueError("独立 HTML 仍包含外部 JS/CSS 引用")
    if "__WORKSPACE_" in html:
        raise ValueError("独立 HTML 仍包含未替换占位符")
    if config.get("templateId") not in {"xiaoshui", "admin-minimal", "student-campus"}:
        raise ValueError("templateId 不在白名单")
    dist = project / "dist"
    output = dist / "index.html"
    temporary = dist / ".index.html.tmp"
    temporary.write_text(html, encoding="utf-8")
    os.replace(temporary, output)
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project_dir", type=Path)
    args = parser.parse_args()
    output = build(args.project_dir)
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
