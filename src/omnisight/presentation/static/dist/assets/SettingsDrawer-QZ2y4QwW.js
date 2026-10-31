import { G as require_jsx_runtime, W as Icon, k as fail, w as getState } from "./degraded-kEO3Hn2f.js";
import { c as Drawer, s as pageUrl, u as openOverlay } from "./shell-D8sMQ96s.js";
import { n as loadSettings, t as SettingsPage } from "./SettingsPage-JUQVxjGA.js";
//#region frontend/src/pages/SettingsDrawer.tsx
var import_jsx_runtime = require_jsx_runtime();
async function openSettingsDrawer() {
	if (getState().settings) loadSettings().catch(() => fail("重读设置失败"));
	else try {
		await loadSettings();
	} catch {
		fail("读不到设置，请刷新页面重试");
		return;
	}
	openOverlay(/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Drawer, {
		title: "设置",
		wide: true,
		headExtra: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
			className: "icon-button",
			href: pageUrl("/settings"),
			"aria-label": "在独立页面中打开设置",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "external" })
		}),
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "page",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SettingsPage, { surface: "drawer" })
		})
	}));
}
//#endregion
export { openSettingsDrawer };
