"""Capture annotated WebUI screenshots from a running upstream control panel."""
from __future__ import annotations

import argparse
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parents[1] / "public" / "images"
OUT.mkdir(parents=True, exist_ok=True)

MASK_JS = r"""
(() => {
  const re = /key|token|secret|password/i;
  document.querySelectorAll('input, textarea').forEach((el) => {
    const hay = ((el.id || '') + ' ' + (el.name || '') + ' ' + (el.type || '')).toLowerCase();
    if (el.type === 'password' || re.test(hay)) {
      if (el.value && el.value.trim()) el.value = '********';
      el.type = 'password';
    }
  });
})();
"""

ANNO_JS = r"""
(selectors) => {
  document.querySelectorAll('.doc-anno').forEach((n) => n.remove());
  document.querySelectorAll('[data-doc-outline]').forEach((el) => {
    el.style.outline = '';
    el.removeAttribute('data-doc-outline');
  });
  (selectors || []).forEach(([sel, n]) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.style.outline = '3px solid #ff2d55';
    el.style.outlineOffset = '3px';
    el.setAttribute('data-doc-outline', '1');
    const r = el.getBoundingClientRect();
    const b = document.createElement('div');
    b.className = 'doc-anno';
    b.textContent = String(n);
    Object.assign(b.style, {
      position: 'fixed',
      left: Math.max(4, r.left - 14) + 'px',
      top: Math.max(4, r.top - 14) + 'px',
      width: '24px',
      height: '24px',
      borderRadius: '50%',
      background: '#ff2d55',
      color: '#fff',
      fontWeight: '700',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 99999,
      fontFamily: 'Segoe UI, sans-serif',
      fontSize: '13px',
      boxShadow: '0 0 0 2px #fff'
    });
    document.body.appendChild(b);
  });
}
"""

CLEAR_ANNO_JS = r"""
() => {
  document.querySelectorAll('.doc-anno').forEach((n) => n.remove());
  document.querySelectorAll('[data-doc-outline]').forEach((el) => {
    el.style.outline = '';
    el.removeAttribute('data-doc-outline');
  });
}
"""


def shot(page, name, full=True):
    page.evaluate(MASK_JS)
    time.sleep(0.15)
    path = OUT / name
    page.screenshot(path=str(path), full_page=full)
    print("wrote", path.name)


def click_tab(page, name):
    page.evaluate(
        """(tabName) => {
            if (typeof switchTab === 'function') switchTab(tabName);
            document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
            document.querySelectorAll('.tab-button').forEach((b) => b.classList.remove('active'));
            const panel = document.getElementById(tabName);
            if (!panel) throw new Error('missing tab ' + tabName);
            panel.classList.add('active');
            const btn = document.querySelector(`.tab-button[onclick*="'${tabName}'"]`);
            if (btn) btn.classList.add('active');
        }""",
        name,
    )
    time.sleep(0.4)


def click_sub(page, scope, tab_key):
    page.evaluate(
        """([scope, tabKey]) => {
            const btn = document.querySelector(`${scope} .sub-tab-button[onclick*="'${tabKey}'"]`);
            if (!btn) throw new Error('missing subtab ' + tabKey);
            btn.click();
        }""",
        [scope, tab_key],
    )
    time.sleep(0.35)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--mode", choices=["local", "cloud"], required=True)
    args = parser.parse_args()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.goto(args.url, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(1500)

        prefix = "local" if args.mode == "local" else "cloud"

        if args.mode == "local":
            click_tab(page, "dashboard")
            page.evaluate(CLEAR_ANNO_JS)
            shot(page, "webui-home.png")
            page.evaluate(ANNO_JS, [[".tabs", "1"], ["header h1", "2"]])
            shot(page, "webui-sidebar.png")
            page.evaluate(ANNO_JS, [[".dashboard", "1"], [".info-actions", "2"]])
            shot(page, "webui-services.png")
            page.evaluate(ANNO_JS, [["#asr-start", "1"], ["#asr-status", "2"]])
            shot(page, "webui-service-asr.png", full=False)
            page.evaluate(ANNO_JS, [["#tts-start", "1"], ["#tts-status", "2"]])
            shot(page, "webui-service-tts.png", full=False)
            page.evaluate(ANNO_JS, [["#live2d-start", "1"], ["#live2dGateHint", "2"]])
            shot(page, "webui-service-live2d.png", full=False)
            page.evaluate(ANNO_JS, [["#memos-start", "1"]])
            shot(page, "webui-service-memos.png", full=False)
            page.evaluate(ANNO_JS, [["#rag-start", "1"]])
            shot(page, "webui-service-rag.png", full=False)
            page.evaluate(ANNO_JS, [["#bert-start", "1"]])
            shot(page, "webui-service-bert.png", full=False)
            page.evaluate(ANNO_JS, [[".info-actions .btn-start", "1"]])
            shot(page, "webui-oneclick.png", full=False)
            page.evaluate(ANNO_JS, [[".log-section", "1"]])
            shot(page, "webui-logs.png")
            page.evaluate(ANNO_JS, [["#overview-board", "1"]])
            shot(page, "webui-overview.png")

            click_tab(page, "basic-config")
            page.evaluate(CLEAR_ANNO_JS)
            shot(page, "webui-basic.png")
            page.evaluate(ANNO_JS, [["#vision-model-select", "1"], ["#mcp-enabled", "2"]])
            shot(page, "webui-basic-highlight.png")

            click_tab(page, "dialog-config")
            page.evaluate(CLEAR_ANNO_JS)
            shot(page, "webui-dialog-full.png")
            page.evaluate(ANNO_JS, [["#asr-enabled", "1"], ["#tts-enabled", "2"]])
            shot(page, "webui-dialog-asr.png")
            page.evaluate(ANNO_JS, [["#ptt-enabled", "1"], ["#ptt-key-binding", "2"]])
            shot(page, "webui-dialog-ptt.png")
            page.evaluate(ANNO_JS, [["#show-chat-box", "1"], ["#dialog-model-select", "2"]])
            shot(page, "first-chat-text.png")
            page.evaluate(ANNO_JS, [["#voice-barge-in", "1"]])
            shot(page, "webui-dialog-barge.png")

            click_tab(page, "persona-config")
            page.evaluate(CLEAR_ANNO_JS)
            shot(page, "webui-persona.png")

            click_tab(page, "llm-config")
            page.evaluate(CLEAR_ANNO_JS)
            shot(page, "webui-llm.png")
            page.evaluate(ANNO_JS, [[".llm-provider-sidebar", "1"], ["#llm-fallback-model-select", "2"]])
            shot(page, "webui-llm-sidebar.png")
            page.evaluate(
                """() => {
                    const btn = document.querySelector('#llm-config button, .llm-provider-sidebar button');
                    const buttons = Array.from(document.querySelectorAll('#llm-config button'));
                    const add = buttons.find((b) => (b.textContent || '').includes('添加'));
                    if (add) add.click();
                }"""
            )
            page.wait_for_timeout(400)
            page.evaluate(ANNO_JS, [["#llm-provider-editor-body", "1"]])
            shot(page, "webui-llm-add.png")

            click_tab(page, "voice-settings")
            page.evaluate(CLEAR_ANNO_JS)
            shot(page, "webui-cloud-tts-tabs.png")
            click_sub(page, "#voice-settings", "gateway")
            page.evaluate(ANNO_JS, [["#gateway-enabled", "1"], ["#gateway-api-key", "2"]])
            shot(page, "webui-cloud-gateway.png")
            page.evaluate("document.getElementById('gateway-enabled').checked = true")
            page.wait_for_timeout(200)
            page.evaluate(ANNO_JS, [["#gateway-enabled", "1"]])
            shot(page, "webui-cloud-gateway-checked.png")
            page.evaluate("document.getElementById('gateway-enabled').checked = false")

            click_sub(page, "#voice-settings", "tts")
            page.evaluate(ANNO_JS, [["#cloud-tts-enabled", "1"], ["#cloud-api-key", "2"]])
            shot(page, "webui-cloud-tts-silicon.png")

            click_sub(page, "#voice-settings", "aliyun")
            page.evaluate(
                ANNO_JS,
                [
                    ["#aliyun-tts-enabled", "1"],
                    ["#aliyun-tts-api-key", "2"],
                    ["#aliyun-tts-workspace-id", "3"],
                    ["#aliyun-tts-model", "4"],
                    ["#aliyun-tts-voice", "5"],
                ],
            )
            shot(page, "webui-aliyun-tts.png")
            page.evaluate("document.getElementById('aliyun-tts-enabled').checked = true")
            page.wait_for_timeout(150)
            page.evaluate(ANNO_JS, [["#aliyun-tts-enabled", "1"]])
            shot(page, "webui-aliyun-enabled.png")
            page.evaluate("document.getElementById('aliyun-tts-enabled').checked = false")

            click_sub(page, "#voice-settings", "volcengine")
            page.evaluate(ANNO_JS, [["#volcengine-tts-enabled", "1"]])
            shot(page, "webui-volcengine-tts.png")

            click_sub(page, "#voice-settings", "baidu")
            page.evaluate(ANNO_JS, [["#baidu-asr-enabled", "1"]])
            shot(page, "webui-cloud-baidu-asr.png")

            click_tab(page, "ui-settings")
            page.evaluate(CLEAR_ANNO_JS)
            shot(page, "webui-live2d.png")
            page.evaluate(ANNO_JS, [["#live2d-preview-workbench", "1"]])
            shot(page, "desktop-pet.png")
            click_sub(page, "#ui-settings", "motion")
            page.evaluate(CLEAR_ANNO_JS)
            shot(page, "webui-live2d-motion.png")
            click_sub(page, "#ui-settings", "expression")
            shot(page, "webui-live2d-expression.png")
            click_sub(page, "#ui-settings", "ui")
            shot(page, "webui-live2d-ui.png")

            click_tab(page, "model-manager")
            page.evaluate(CLEAR_ANNO_JS)
            shot(page, "webui-voice-clone.png")
            train_ok = page.evaluate(
                "() => { const btn = document.querySelector('#model-manager .sub-tab-button[onclick*=\"train\"]'); if (!btn) return false; btn.click(); return true; }"
            )
            if train_ok:
                page.wait_for_timeout(300)
                shot(page, "webui-voice-clone-train.png")

            click_tab(page, "market")
            page.evaluate(CLEAR_ANNO_JS)
            shot(page, "webui-market.png")
            for tab_key, fname in [
                ("tool", "webui-market-tool.png"),
                ("fc", "webui-market-fc.png"),
                ("plugin", "webui-market-plugin.png"),
            ]:
                click_sub(page, "#market", tab_key)
                shot(page, fname)

            click_tab(page, "plugins")
            page.evaluate(CLEAR_ANNO_JS)
            shot(page, "webui-plugins.png")
            comm_ok = page.evaluate(
                "() => { const btn = document.querySelector('#plugins .sub-tab-button[onclick*=\"community\"]'); if (!btn) return false; btn.click(); return true; }"
            )
            if comm_ok:
                page.wait_for_timeout(300)
                shot(page, "webui-plugins-community.png")

            page.evaluate(ANNO_JS, [["#switchToClassicLayoutBtn", "1"], ["#language-selector", "2"]])
            shot(page, "webui-header-controls.png", full=False)

            # mixed-use composition: dialog + cloud tts reminder
            click_tab(page, "dialog-config")
            page.evaluate("document.getElementById('asr-enabled').checked = true; document.getElementById('tts-enabled').checked = true")
            page.evaluate(ANNO_JS, [["#asr-enabled", "1"], ["#tts-enabled", "2"]])
            shot(page, "mix-dialog-toggles.png")
            click_tab(page, "voice-settings")
            click_sub(page, "#voice-settings", "aliyun")
            page.evaluate("document.getElementById('aliyun-tts-enabled').checked = true")
            page.evaluate(ANNO_JS, [["#aliyun-tts-enabled", "1"]])
            shot(page, "mix-aliyun-only.png")
            page.evaluate("document.getElementById('aliyun-tts-enabled').checked = false")
            click_tab(page, "dashboard")
            page.evaluate(ANNO_JS, [["#asr-start", "1"], ["#tts-start", "2"]])
            shot(page, "mix-services-asr-not-tts.png")

        else:
            click_tab(page, "dashboard")
            page.evaluate(ANNO_JS, [["header h1", "1"], [".dashboard", "2"]])
            shot(page, "webui-cloud-title.png")
            page.evaluate(CLEAR_ANNO_JS)
            shot(page, "webui-cloud-services-hidden.png")
            click_tab(page, "voice-settings")
            page.evaluate(CLEAR_ANNO_JS)
            shot(page, "webui-cloud-only-voice.png")
            page.locator("button.tab-button").all_inner_texts()
            page.evaluate(ANNO_JS, [[".tabs", "1"]])
            shot(page, "webui-cloud-no-clone-tab.png")

        browser.close()
        print("done", prefix)


if __name__ == "__main__":
    main()
