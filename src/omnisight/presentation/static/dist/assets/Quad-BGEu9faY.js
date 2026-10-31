import { K as require_jsx_runtime } from "./degraded-CHoep9Ns.js";
//#region frontend/src/components/Quad.tsx
var import_jsx_runtime = require_jsx_runtime();
function Quad({ items }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "quad",
		children: items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "quad__cell",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "quad__label",
				children: item.label
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", {
				className: "quad__value",
				title: item.value,
				children: item.value
			})]
		}, item.label))
	});
}
//#endregion
export { Quad as t };
