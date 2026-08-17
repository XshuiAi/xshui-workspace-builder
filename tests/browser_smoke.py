from __future__ import annotations

import json
import tempfile
from pathlib import Path

from playwright.sync_api import Page, sync_playwright


BASE = "http://127.0.0.1:8766/examples"
ARTIFACTS = Path(tempfile.gettempdir()).resolve() / "xshui-browser-artifacts"
ARTIFACTS.mkdir(parents=True, exist_ok=True)
FIXTURE_ONE = Path(__file__).with_name("fixture-one.svg")
FIXTURE_TWO = Path(__file__).with_name("fixture-two.svg")


def assert_no_overflow(page: Page) -> None:
    sizes = page.evaluate("() => ({scroll: document.documentElement.scrollWidth, inner: window.innerWidth})")
    assert sizes["scroll"] <= sizes["inner"] + 1, sizes


def wait_saved(page: Page) -> None:
    page.wait_for_function("() => [...document.querySelectorAll('[data-save-state]')].some(node => node.textContent.includes('已保存到本机'))")
    page.wait_for_timeout(150)


def capture_templates(browser) -> list[dict]:
    results = []
    templates = {
        "xiaoshui": "xiaoshui-demo",
        "admin": "admin-demo",
        "student": "student-demo",
    }
    for label, directory in templates.items():
        for device, viewport in (("desktop", {"width": 1440, "height": 1000}), ("mobile", {"width": 390, "height": 844})):
            context = browser.new_context(viewport=viewport, locale="zh-CN")
            page = context.new_page()
            errors: list[str] = []
            page.on("console", lambda msg, errors=errors: errors.append(msg.text) if msg.type == "error" else None)
            page.on("pageerror", lambda exc, errors=errors: errors.append(str(exc)))
            page.goto(f"{BASE}/{directory}/dist/index.html", wait_until="networkidle")
            page.locator("#app").wait_for()
            assert_no_overflow(page)
            path = ARTIFACTS / f"{label}-{device}.png"
            page.screenshot(path=str(path), full_page=True)
            page.locator('.hero-actions [data-action="go"]').first.click()
            page.wait_for_load_state("networkidle")
            assert_no_overflow(page)
            dashboard_path = ARTIFACTS / f"{label}-dashboard-{device}.png"
            page.screenshot(path=str(dashboard_path), full_page=True)
            results.append({"template": label, "device": f"dashboard-{device}", "screenshot": str(dashboard_path)})
            assert not errors, errors
            results.append({"template": label, "device": device, "screenshot": str(path)})
            context.close()
    return results


def interaction_test(browser) -> dict:
    context = browser.new_context(viewport={"width": 1280, "height": 900}, locale="zh-CN")
    page = context.new_page()
    errors: list[str] = []
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    page.goto(f"{BASE}/xiaoshui-demo/dist/index.html", wait_until="networkidle")
    assert page.locator("svg.hero-line-stage").count() == 0
    page.get_by_role("button", name="进入今日总览").click()
    page.wait_for_url("**#today")

    page.locator('[data-action="new-record"][data-module="today"]').click()
    page.locator('form[data-record-form] input[name="title"]').fill("浏览器验收任务")
    page.locator('form[data-record-form] textarea[name="note"]').fill("验证新增、刷新与完成状态")
    page.locator('form[data-record-form] button[type="submit"]').click()
    page.get_by_text("浏览器验收任务", exact=True).first.wait_for()
    wait_saved(page)
    page.reload(wait_until="networkidle")
    page.get_by_text("浏览器验收任务", exact=True).first.wait_for()

    row = page.locator("article.record").filter(has_text="浏览器验收任务")
    row.locator('[data-action="toggle-record"]').click()
    page.get_by_text("已完成", exact=True).first.wait_for()
    wait_saved(page)
    page.reload(wait_until="networkidle")
    row = page.locator("article.record").filter(has_text="浏览器验收任务")
    assert "已完成" in row.inner_text()

    page.keyboard.press("e")
    heading = page.locator('h1[data-edit-key="module.today.label"]')
    heading.fill("今日看板")
    page.locator('[data-editor-action="font-up"]').click()
    page.locator('[data-editor-action="undo"]').click()
    page.locator('[data-editor-action="redo"]').click()
    page.locator('[data-editor-action="exit"]').click()
    wait_saved(page)
    page.reload(wait_until="networkidle")
    page.get_by_text("今日看板", exact=True).first.wait_for()

    page.locator('[data-action="go"][data-route="inbox"]').click()
    page.wait_for_url("**#inbox")
    page.keyboard.press("e")
    page.locator('[data-action="hide-module"][data-module="inbox"]').click()
    assert page.locator('[data-nav-id="inbox"]').count() == 0
    page.locator('[data-editor-action="hidden"]').click()
    page.locator('[data-action="restore-module"][data-module="inbox"]').click()
    page.locator('[data-nav-id="inbox"]').wait_for()

    page.locator('[data-action="go"][data-route="today"]').click()
    page.wait_for_url("**#today")
    page.locator('[data-optional-action="module.today.new"]').hover()
    page.locator('[data-action="hide-action"][data-action-id="module.today.new"]').click()
    assert page.locator('[data-action="new-record"][data-module="today"]').count() == 0
    page.locator('[data-editor-action="hidden"]').click()
    page.locator('[data-action="restore-action"][data-action-id="module.today.new"]').click()
    page.locator('[data-action="new-record"][data-module="today"]').wait_for()

    page.locator('[data-editor-image]').set_input_files(str(FIXTURE_ONE))
    page.locator('[data-asset-id]').wait_for()
    wait_saved(page)
    assert page.locator('[data-asset-id] img').get_attribute("alt") == "fixture-one"
    page.locator('[data-image-replace]').set_input_files(str(FIXTURE_TWO))
    wait_saved(page)
    assert page.locator('[data-asset-id] img').get_attribute("alt") == "fixture-two"
    page.locator('[data-action="image-size"][data-size="l"]').click()
    wait_saved(page)
    page.reload(wait_until="networkidle")
    page.locator('[data-asset-id].size-l').wait_for()
    page.keyboard.press("e")
    page.locator('[data-action="image-remove"]').click()
    wait_saved(page)
    page.reload(wait_until="networkidle")
    assert page.locator('[data-asset-id]').count() == 0

    assert_no_overflow(page)
    assert not errors, errors
    result = {"record_persisted": True, "status_persisted": True, "editor_persisted": True, "module_hide_restore": True, "button_hide_restore": True, "image_upload_replace_resize_delete": True}
    context.close()
    return result


def main() -> None:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        result = {"screenshots": capture_templates(browser), "interactions": interaction_test(browser)}
        browser.close()
    (ARTIFACTS / "report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
