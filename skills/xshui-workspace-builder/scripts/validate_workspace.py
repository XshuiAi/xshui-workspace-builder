#!/usr/bin/env python3
"""Static validation for generated XShui workspace projects."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from build_standalone import MARKER, SCRIPT_ORDER, validate_project


def validate(project_dir: Path) -> list[str]:
    errors: list[str] = []
    try:
        project = validate_project(project_dir)
    except ValueError as exc:
        return [str(exc)]
    src = project / "src"
    try:
        config = json.loads((src / "template.json").read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        return [f"template.json 无效：{exc}"]
    module_ids = [module.get("id") for module in config.get("modules", [])]
    if not module_ids or any(not isinstance(value, str) or not value for value in module_ids):
        errors.append("模块 ID 缺失")
    if len(module_ids) != len(set(module_ids)):
        errors.append("模块 ID 重复")
    if not any(module.get("protected") for module in config.get("modules", [])):
        errors.append("至少需要一个受保护模块")
    if not any(module.get("archive") for module in config.get("modules", [])):
        errors.append("缺少归档与备份模块")
    standalone = project / "dist" / "index.html"
    if not standalone.is_file():
        errors.append("缺少 dist/index.html")
    else:
        html = standalone.read_text(encoding="utf-8")
        checks = {
            "备份格式": "xshui-workspace-backup",
            "编辑器入口": "data-action=\"edit-mode\"",
            "IndexedDB": "indexedDB.open",
            "导入预览": "IMPORT PREVIEW",
            "移动端 viewport": "width=device-width",
            "跳过导航链接": "skip-link",
        }
        for label, token in checks.items():
            if token not in html:
                errors.append(f"独立 HTML 缺少：{label}")
        if re.search(r'<(?:script|link)[^>]+(?:src|href)="[^\"]+\.(?:js|css)"', html):
            errors.append("独立 HTML 含外部 JS/CSS 引用")
        if "hero-line-stage" in html or "animateMotion" in html:
            errors.append("模板仍包含已禁止的首页轨道动图")
        if any(secret in html.lower() for secret in ("access_token=", "api_key=", "authorization: bearer", "cookie:")):
            errors.append("疑似包含敏感凭证")
    if not (project / MARKER).is_file():
        errors.append("缺少输出归属标记")
    for script_name in SCRIPT_ORDER:
        if not (src / script_name).is_file():
            errors.append(f"缺少 {script_name}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project_dir", type=Path)
    args = parser.parse_args()
    errors = validate(args.project_dir)
    if errors:
        print("VALIDATION FAILED")
        for error in errors:
            print(f"- {error}")
        return 1
    print("VALIDATION PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
