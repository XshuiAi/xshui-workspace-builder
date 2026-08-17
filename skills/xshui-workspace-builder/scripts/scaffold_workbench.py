#!/usr/bin/env python3
"""Safely scaffold an editable XShui workspace from a white-listed template."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import uuid
from datetime import datetime
from pathlib import Path

from build_standalone import build
from validate_workspace import validate

SKILL_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = SKILL_DIR.parents[1]
TEMPLATE_ROOT = SKILL_DIR / "assets" / "templates"
SHARED_ROOT = TEMPLATE_ROOT / "shared"
RUNTIME_ROOT = SKILL_DIR / "runtime"
MARKER = ".xshui-workspace-output"
ALLOWED_TEMPLATES = {"xiaoshui", "admin-minimal", "student-campus"}
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


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


def validate_output_root(raw: str) -> Path:
    if raw in {".", "..", "/", "~"} or "~" in raw.split(os.sep) or ".." in Path(raw).parts:
        raise ValueError("输出根目录过于宽泛或包含路径穿越")
    supplied = Path(raw)
    if not supplied.is_absolute():
        raise ValueError("输出根目录必须是用户确认过的绝对路径")
    if has_symlink_component(supplied):
        raise ValueError("输出路径不能包含符号链接")
    resolved = supplied.resolve(strict=False)
    home = Path.home().resolve()
    cwd = Path.cwd().resolve()
    protected_exact = {Path("/").resolve(), home, cwd, REPO_ROOT.resolve(), SKILL_DIR.resolve(), TEMPLATE_ROOT.resolve(), SHARED_ROOT.resolve(), RUNTIME_ROOT.resolve()}
    if resolved in protected_exact:
        raise ValueError("不能把 Home、当前目录、仓库根、Skill 根或模板源作为输出根目录")
    for protected in (REPO_ROOT.resolve(), SKILL_DIR.resolve(), TEMPLATE_ROOT.resolve(), SHARED_ROOT.resolve(), RUNTIME_ROOT.resolve()):
        if is_relative_to(protected, resolved):
            raise ValueError("输出根目录不能是仓库、Skill 或模板源的祖先")
    return resolved


def is_owned_output(target: Path) -> bool:
    marker = target / MARKER
    if not marker.is_file() or marker.is_symlink():
        return False
    try:
        value = json.loads(marker.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return False
    return value.get("tool") == "xshui-workspace-builder" and value.get("version") == 1 and bool(value.get("createdAt"))


def write_docs(stage: Path, template: dict) -> None:
    (stage / "DATA_AND_USAGE.md").write_text(
        f"# {template['profile']['title']}\n\n"
        "- 推荐打开：`dist/index.html`。\n"
        "- 源码在 `src/`，修改后运行 Skill 的 `build_standalone.py`。\n"
        "- 业务数据保存在当前浏览器 IndexedDB，不在源码目录。\n"
        "- 更换浏览器或清理站点数据前，请在归档页面导出 JSON。\n"
        "- 第一版不含账号、云同步或团队协作。\n",
        encoding="utf-8",
    )
    (stage / "AGENT_HANDOFF.md").write_text(
        "# Agent handoff\n\n"
        "先读 `src/template.json`、`src/app.js`、`DATA_AND_USAGE.md`。模块和设计配置以 `src/template.json` 为真源；不要直接修改 `dist/index.html`。"
        "保留 IndexedDB、备份预览、合并/恢复、受控编辑器和路径安全约束。\n",
        encoding="utf-8",
    )


def scaffold(args: argparse.Namespace) -> Path:
    if args.template not in ALLOWED_TEMPLATES:
        raise ValueError(f"模板必须是：{', '.join(sorted(ALLOWED_TEMPLATES))}")
    if not SLUG.fullmatch(args.name):
        raise ValueError("项目名只能使用小写字母、数字和单个连字符")
    output_root = validate_output_root(args.output_root)
    output_root.mkdir(parents=True, exist_ok=True)
    if output_root.is_symlink():
        raise ValueError("输出根目录不能是符号链接")
    target = (output_root / args.name).resolve(strict=False)
    if target.parent != output_root:
        raise ValueError("项目路径越过了输出根目录")
    if target.is_symlink():
        raise ValueError("目标不能是符号链接")
    if target.exists():
        if not args.force:
            raise ValueError("目标目录已存在；请选择新项目名，或在确认工具归属后使用 --force")
        if not is_owned_output(target):
            raise ValueError("已有目录不是本工具生成，禁止 --force 覆盖")

    stage = output_root / f".{args.name}.staging-{uuid.uuid4().hex[:8]}"
    if stage.exists() or stage.is_symlink():
        raise ValueError("暂存目录冲突")
    stage.mkdir()
    try:
        src = stage / "src"
        dist = stage / "dist"
        src.mkdir()
        dist.mkdir()
        template = json.loads((TEMPLATE_ROOT / args.template / "template.json").read_text(encoding="utf-8"))
        template["appId"] = f"xshui-{args.template}-{args.name}"
        template["profile"]["ownerName"] = args.owner_name.strip() or template["profile"]["ownerName"]
        template["profile"]["title"] = args.title.strip() or f"{template['profile']['ownerName']}的工作台"
        source_html = (SHARED_ROOT / "source.html").read_text(encoding="utf-8")
        source_html = source_html.replace("__WORKSPACE_TITLE__", template["profile"]["title"])
        source_html = source_html.replace("__WORKSPACE_CONFIG__", json.dumps(template, ensure_ascii=False).replace("<", "\\u003c"))
        (src / "index.html").write_text(source_html, encoding="utf-8")
        (src / "template.json").write_text(json.dumps(template, ensure_ascii=False, indent=2), encoding="utf-8")
        shutil.copy2(SHARED_ROOT / "styles.css", src / "styles.css")
        for name in ("storage.js", "backup.js", "editor.js", "app.js"):
            shutil.copy2(RUNTIME_ROOT / name, src / name)
        (stage / MARKER).write_text(json.dumps({"tool": "xshui-workspace-builder", "version": 1, "createdAt": datetime.now().isoformat()}), encoding="utf-8")
        write_docs(stage, template)
        build(stage)
        errors = validate(stage)
        if errors:
            raise ValueError("生成后验证失败：" + "; ".join(errors))
        backup = None
        if target.exists():
            backup = output_root / f".{args.name}.bak-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
            os.replace(target, backup)
        try:
            os.replace(stage, target)
        except Exception:
            if backup and backup.exists() and not target.exists():
                os.replace(backup, target)
            raise
        return target
    except Exception:
        print(f"生成未完成；为便于检查，暂存目录保留在：{stage}", file=sys.stderr)
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template", required=True)
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--owner-name", default="")
    parser.add_argument("--title", default="")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    try:
        target = scaffold(args)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    print(target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
