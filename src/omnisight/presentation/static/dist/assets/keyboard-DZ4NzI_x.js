const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/Keyboard3D-BTiLW2xg.js","assets/degraded-CHoep9Ns.js","assets/main-81ZjbgCL.js","assets/shell-BR8VnMpZ.js","assets/controls-BqnHbx0e.js","assets/AboutContent-DXF4RmAb.js","assets/press-stream-Bdui_rNf.js"])))=>i.map(i=>d[i]);
import { D as setState, G as Icon, I as get, J as require_react, K as require_jsx_runtime, T as getState, W as on, _ as useSlice, a as hide, b as prefersReducedMotion, c as formatCount, g as useResource, m as formatPercent, n as capabilityOf, o as show, q as require_react_dom, r as noticeFor } from "./degraded-CHoep9Ns.js";
import { i as Segmented } from "./controls-BqnHbx0e.js";
import { _ as webglAvailable, a as fromISO, c as HEAT_BOUNDS, d as formatMetric, f as heatLevel, g as __vitePreload, h as metricOf, i as bucketCoversGap, l as METRICS, m as isSaturated, n as METRIC_SLOT_ID, o as gapSet, p as heatRatio, r as Updated, s as periodParams, t as fetchInto, u as TIMELINE_VIEWS } from "./main-81ZjbgCL.js";
import { n as Section, t as Card } from "./Card-DIaFJFp4.js";
import { a as RATE_STEP, d as subscribe, f as toggle, i as MIN_RATE, l as setRate, o as formatRate, r as decodePressStream, s as getReplay, u as stop } from "./press-stream-Bdui_rNf.js";
import { r as Mark, t as AppGrid } from "./AppGrid-Dxp-aGM-.js";
import { t as Quad } from "./Quad-BGEu9faY.js";
import { a as SkeletonRows, i as GapLegend, n as EmptyState, r as ErrorState, t as CapabilityNotice } from "./states-Qok1NqPy.js";
import { i as Chart, n as hideChartTooltip, r as showChartTooltip } from "./axis-DY4SNg7k.js";
import { n as scaleBarsDraw, t as scaleBarsDescribe } from "./scale-bars-DWjPbk9a.js";
//#region frontend/src/charts/CalendarHeatmap.tsx
var import_react_dom = require_react_dom();
var import_react = require_react();
var import_jsx_runtime = require_jsx_runtime();
var WEEKDAYS = [
	"一",
	"二",
	"三",
	"四",
	"五",
	"六",
	"日"
];
function CalendarHeatmap({ buckets, scale, gaps, weekStartsOn = 0, metric = "press_count", onSelect = null }) {
	const cells = (0, import_react.useMemo)(() => padToWeeks(buckets || [], weekStartsOn, metric), [
		buckets,
		weekStartsOn,
		metric
	]);
	const months = (0, import_react.useMemo)(() => monthMarks(cells), [cells]);
	const columns = Math.max(1, Math.ceil(cells.length / 7));
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "calendar",
		style: { "--columns": columns },
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "heatgrid__months",
				"aria-hidden": "true",
				children: months.map((mark) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "heatgrid__month",
					style: { gridColumn: mark.column },
					children: mark.label
				}, mark.column))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "weekday-axis",
				children: Array.from({ length: 7 }, (_unused, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: index % 2 === 0 ? WEEKDAYS[(index + weekStartsOn) % 7] : "" }, index))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "heatgrid",
				role: "group",
				"aria-label": "每日活跃度",
				onClick: onSelect ? (event) => {
					const bucket = event.target.closest(".heat-cell")?.dataset.bucket;
					if (bucket) onSelect(bucket);
				} : void 0,
				children: cells.map((cell) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HeatCell, {
					cell,
					scale,
					gap: Boolean(cell.bucket && gaps?.has(cell.bucket))
				}, cell.key))
			})
		]
	});
}
function HeatCell({ cell, scale, gap }) {
	if (cell.empty) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "heat-cell",
		"data-empty": "true"
	});
	const ratio = gap ? 0 : heatRatio(cell.value, scale);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "heat-cell",
		"data-bucket": cell.bucket,
		"data-level": heatLevel(ratio),
		"data-gap": gap ? "true" : void 0,
		"aria-label": gap ? `${cell.bucket}：无记录` : `${cell.bucket}：${formatCount(cell.value)} 次`
	});
}
/** 首尾补空格子，让第一列从"周起始日"开始，否则整张图会错位一天。 */
function padToWeeks(buckets, weekStartsOn, metric) {
	if (!buckets.length) return [];
	const read = (item) => Number(item[metric]) || 0;
	const first = fromISO(buckets[0].bucket);
	if (!first) return buckets.map((item) => ({
		key: item.bucket,
		bucket: item.bucket,
		value: read(item)
	}));
	const offset = ((first.getDay() + 6) % 7 - weekStartsOn + 7) % 7;
	const padded = [];
	for (let index = 0; index < offset; index += 1) padded.push({
		key: `pad-${index}`,
		empty: true
	});
	for (const item of buckets) padded.push({
		key: item.bucket,
		bucket: item.bucket,
		value: read(item)
	});
	return padded;
}
/**
* 月份标签落在哪一列。
*
* 格子是按列填的（`grid-auto-flow: column`，每列 7 天），所以第 n 个格子在第
* `floor(n / 7) + 1` 列——每个月的第一天落在哪一列，标签就放在哪一列。
*/
function monthMarks(cells) {
	const marks = [];
	let previous = "";
	cells.forEach((cell, index) => {
		if (cell.empty || !cell.bucket) return;
		const month = cell.bucket.slice(0, 7);
		if (month === previous) return;
		previous = month;
		marks.push({
			column: Math.floor(index / 7) + 1,
			label: `${Number(month.slice(5, 7))} 月`
		});
	});
	return marks.filter((mark, index) => index === 0 || mark.column - marks[index - 1].column >= 4);
}
//#endregion
//#region frontend/src/components/AppPicker.tsx
var FOCUSABLE = "button:not([disabled]), input:not([disabled])";
function AppPicker({ apps, runningIds = [], onChange = null }) {
	const scopeAppId = useSlice("scopeAppId");
	const [open, setOpen] = (0, import_react.useState)(false);
	const root = (0, import_react.useRef)(null);
	const panel = (0, import_react.useRef)(null);
	const trigger = (0, import_react.useRef)(null);
	const list = apps || [];
	(0, import_react.useEffect)(() => {
		const current = getState().scopeAppId;
		if (current && list.length && !list.some((app) => app.app_id === current)) setState("scopeAppId", null);
	}, [list]);
	(0, import_react.useEffect)(() => {
		if (!open) return;
		const onKeydown = (event) => {
			if (event.key === "Escape") {
				event.preventDefault();
				setOpen(false);
				trigger.current?.focus();
				return;
			}
			if (event.key !== "Tab") return;
			const host = panel.current;
			if (!host) return;
			const items = [...host.querySelectorAll(FOCUSABLE)].filter((node) => node.offsetParent !== null);
			if (!items.length) return;
			const first = items[0];
			const last = items[items.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};
		const onPointerDown = (event) => {
			if (event.target instanceof Node && root.current?.contains(event.target)) return;
			setOpen(false);
		};
		document.addEventListener("keydown", onKeydown, true);
		document.addEventListener("pointerdown", onPointerDown, true);
		return () => {
			document.removeEventListener("keydown", onKeydown, true);
			document.removeEventListener("pointerdown", onPointerDown, true);
		};
	}, [open]);
	const pick = (appId) => {
		setState("scopeAppId", appId);
		setOpen(false);
		trigger.current?.focus();
		onChange?.(appId);
	};
	const current = list.find((app) => app.app_id === scopeAppId) || null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "app-picker",
		ref: root,
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "muted text-sm",
				children: "范围"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
				className: "button app-picker__trigger",
				type: "button",
				ref: trigger,
				"aria-haspopup": "dialog",
				"aria-expanded": open,
				onClick: () => setOpen((value) => !value),
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "app-picker__mark",
						children: current ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Mark, { app: current }) : null
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "app-picker__name",
						children: current ? current.user_alias || current.display_name : "全部应用"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, {
						name: "down",
						size: 14
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "app-picker__panel",
				ref: panel,
				hidden: !open,
				role: "dialog",
				"aria-label": "选择应用范围",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AppGrid, {
					apps: list,
					runningIds,
					selectedId: scopeAppId,
					onPick: pick,
					searchKey: open ? "open" : "closed"
				})
			})
		]
	});
}
//#endregion
//#region frontend/src/components/HeatStrip.tsx
/**
* 轴上标签的间隔。12 个以内全标（月、年），再多就抽稀——24 个小时标签在一条格子上会挤成
* 一片灰。抽稀后仍然落在"每 3 小时"这种整齐的位置上，因为 step 是整除出来的。
*/
function labelStep(count) {
	return count <= 12 ? 1 : Math.ceil(count / 8);
}
function HeatStrip({ buckets, scale, valueLabel, format, label }) {
	const step = labelStep(buckets.length);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "heatstrip",
		role: "group",
		"aria-label": label,
		children: buckets.map((bucket, index) => {
			const ratio = bucket.gap ? 0 : heatRatio(bucket.value, scale);
			const title = bucket.label || bucket.bucket;
			return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "heatstrip__slot",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "heat-cell",
					"data-level": heatLevel(ratio),
					"data-gap": bucket.gap ? "true" : void 0,
					"aria-label": bucket.gap ? `${title}：无记录` : `${title}：${format(bucket.value)}`,
					onPointerMove: (event) => show({
						title,
						rows: [[valueLabel, bucket.gap ? "无记录" : format(bucket.value)]],
						note: bucket.gap ? "这一段没有采集覆盖" : void 0,
						x: event.clientX,
						y: event.clientY
					}),
					onPointerLeave: hide
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "heatstrip__label",
					children: index % step === 0 ? title : ""
				})]
			}, bucket.bucket);
		})
	});
}
//#endregion
//#region frontend/src/domain/keyboard-layout.ts
/** 已知的特殊形状。只有一个，且这就是重点（L 形 ISO 回车无法用宽度倍数表达）。 */
var KNOWN_SHAPES = /* @__PURE__ */ new Set(["iso_enter"]);
function isGap(slot) {
	return !slot || slot.id === "gap";
}
/**
* 按行分组的 id，供上下方向键在行间移动。
*/
function keyRows(layout) {
	return (layout?.rows || []).map((row) => row.filter((slot) => !isGap(slot)).map((slot) => slot.id));
}
//#endregion
//#region frontend/src/components/KeyboardView.tsx
var PRESS_CLEAR_MS = 220;
/** 键面数值的字号地板。低于它宁可不印，也不印成 8px（14 文档 §2.5）。 */
var VALUE_MIN_PX = 11;
/** .key-cap__value 的字号系数，与 key-cap.css 里的 calc() 保持一致。 */
var VALUE_RATIO = .27;
function clamp(value, low, high) {
	if (high < low) return low;
	return Math.min(high, Math.max(low, value));
}
function KeyboardView({ layout, heatmap, metric, density = "standard", onSelectKey = null }) {
	const board = (0, import_react.useRef)(null);
	const root = (0, import_react.useRef)(null);
	const caps = (0, import_react.useRef)(/* @__PURE__ */ new Map());
	const [cursor, setCursor] = (0, import_react.useState)({
		row: 0,
		col: 0
	});
	const [valuesVisible, setValuesVisible] = (0, import_react.useState)(true);
	const rows = (0, import_react.useMemo)(() => keyRows(layout), [layout]);
	const values = (0, import_react.useMemo)(() => new Map((heatmap?.keys || []).map((key) => [key.id, key])), [heatmap]);
	const scale = heatmap?.scale || null;
	const total = Number(heatmap?.totals?.press_count) || 0;
	(0, import_react.useEffect)(() => setCursor({
		row: 0,
		col: 0
	}), [layout]);
	(0, import_react.useEffect)(() => {
		const reduced = prefersReducedMotion();
		return on("key:press", (keys) => {
			for (const keyId of keys) {
				const cap = caps.current.get(keyId);
				if (!cap) continue;
				cap.classList.add("is-pressed");
				window.setTimeout(() => cap.classList.remove("is-pressed"), reduced ? 60 : PRESS_CLEAR_MS);
			}
		});
	}, []);
	(0, import_react.useEffect)(() => () => hide(), []);
	/**
	* 键面装不下 11px 的数值就整体藏起来（14 文档 §2.5）。
	*
	* 现状的判据是"窗口 < 1024px"，但真正决定字号的是 --u：1280px 窗口下键面数值只有
	* 8.6px、1100px 下 7.4px，都低于全站 11px 的下限，而窗口宽度那条规则一个都拦不住。
	* 这里改成按实际 --u 算，同一条规则管所有宽度。值印不下时，表格视图仍然给得出。
	*/
	(0, import_react.useEffect)(() => {
		const node = board.current;
		if (!node) return;
		const measure = () => {
			const host = root.current;
			if (!host) return;
			const unit = Number.parseFloat(getComputedStyle(host).getPropertyValue("--u")) || 0;
			setValuesVisible(unit * VALUE_RATIO >= VALUE_MIN_PX);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		return () => observer.disconnect();
	}, [layout, density]);
	(0, import_react.useEffect)(() => () => hide(), []);
	const currentKey = rows[cursor.row]?.[cursor.col] || null;
	const handleKeydown = (event) => {
		const moves = {
			ArrowLeft: [0, -1],
			ArrowRight: [0, 1],
			ArrowUp: [-1, 0],
			ArrowDown: [1, 0]
		};
		if (event.key === "Enter" || event.key === " ") {
			if (currentKey && onSelectKey) {
				onSelectKey(currentKey);
				event.preventDefault();
			}
			return;
		}
		const move = moves[event.key];
		if (!move) return;
		event.preventDefault();
		const nextRow = clamp(cursor.row + move[0], 0, rows.length - 1);
		const rowKeys = rows[nextRow] || [];
		setCursor({
			row: nextRow,
			col: clamp(cursor.col + move[1], 0, rowKeys.length - 1)
		});
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "keyboard-tray-scroll",
		ref: board,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "keyboard-tray",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "keyboard",
				ref: root,
				"data-family": layout?.family || "unknown",
				"data-density": density === "compact" ? "compact" : void 0,
				"data-values": valuesVisible ? "on" : "off",
				role: "group",
				"aria-label": `键盘热力图（${layout?.name || "未知布局"}）`,
				tabIndex: 0,
				"aria-activedescendant": currentKey ? `key-${currentKey}` : void 0,
				onKeyDown: handleKeydown,
				children: (layout?.rows || []).map((row, rowIndex) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "keyboard__row",
					children: row.map((slot, slotIndex) => isGap(slot) ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Spacer, { width: slot?.w }, `gap-${slotIndex}`) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(KeyCap, {
						slot,
						entry: values.get(slot.id),
						metric,
						scale,
						total,
						current: slot.id === currentKey,
						register: (node) => {
							if (node) caps.current.set(slot.id, node);
							else caps.current.delete(slot.id);
						},
						onActivate: onSelectKey
					}, slot.id))
				}, rowIndex))
			})
		})
	}) });
}
function Spacer({ width }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		className: "key-spacer",
		"aria-hidden": "true",
		style: { "--w": width ?? 1 }
	});
}
function KeyCap({ slot, entry, metric, scale, total, current, register, onActivate }) {
	const shape = slot.shape && KNOWN_SHAPES.has(slot.shape) ? slot.shape : void 0;
	if (slot.shape && !shape) console.warn(`未知键形 ${slot.shape}（${slot.id}），按矩形渲染`);
	const definition = metricOf(metric);
	const value = entry ? Number(entry[metric]) || 0 : 0;
	const ratio = heatRatio(value, scale);
	const label = slot.label || slot.id;
	const share = total && metric === "press_count" ? `，占比 ${formatPercent(value / total * 100)}` : "";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		role: "img",
		id: `key-${slot.id}`,
		ref: register,
		className: current ? "key-cap is-current" : "key-cap",
		"data-key-id": slot.id,
		"data-level": heatLevel(ratio),
		"data-saturated": isSaturated(value, scale) ? "true" : void 0,
		"data-shape": shape,
		"aria-label": `${label}，${definition.name} ${definition.format(value)}${share}`,
		style: {
			"--w": slot.w ?? 1,
			"--h": slot.h ?? 1
		},
		onPointerEnter: (event) => show({
			title: label,
			rows: entry ? [
				["次数", formatCount(entry.press_count)],
				["占比", formatPercent(entry.percent)],
				["均时长", formatMetric("duration_avg_ms", entry.duration_avg_ms)]
			] : [["次数", "0"]],
			x: event.clientX,
			y: event.clientY
		}),
		onPointerLeave: () => hide(),
		onClick: onActivate ? () => onActivate(slot.id) : void 0,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "key-cap__label",
			children: label
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "key-cap__value",
			children: value ? definition.format(value) : ""
		})]
	});
}
/**
* 色阶图例。**长在键盘卡头右侧**（17 文档 §4.3，TimeLens 的做法）而不是键盘下方——
* 读者是先看到图例再去读键面的，图例在下面等于让人回头找。因此它导出给视图用，
* 而不是由 KeyboardView 自己渲染在板子底下。
*/
function HeatLegend({ metric, scale }) {
	const definition = metricOf(metric);
	const top = Number(scale?.p95) || 0;
	const max = Number(scale?.max) || 0;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "heat-legend",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "未按过" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "heat-legend__scale",
				"aria-hidden": "true",
				children: [
					0,
					1,
					2,
					3,
					4,
					5
				].map((level) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "heat-legend__step",
					"data-level": level,
					title: level ? `≤ ${definition.format(top * HEAT_BOUNDS[level])}` : "未按过"
				}, level))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: definition.format(top) }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "card__hint",
				title: `色阶按 p95（${definition.format(top)}）归一，超出的键饱和到最深并在右上角切一个缺口。最大值 ${definition.format(max)}。`,
				"aria-label": `色阶按 p95 归一，最大值 ${definition.format(max)}`,
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "p95 归一 " }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, {
					name: "info",
					size: 13
				})]
			})
		]
	});
}
//#endregion
//#region frontend/src/components/KeyboardReadouts.tsx
/** 布局里没有的键（后端的 orphan_keys）。不渲染它们，键盘总数就与指标卡不一致。 */
function Orphans({ keys, metric }) {
	if (!keys?.length) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "orphans",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "orphans__title",
			children: [
				"不在当前布局中的键（",
				keys.length,
				"）"
			]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "orphans__list",
			children: keys.map((key) => {
				const record = key;
				return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
					className: "key-chip",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: key.label || key.id }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: formatMetric(metric, Number(record[metric] ?? key.press_count ?? 0)) })]
				}, key.id);
			})
		})]
	});
}
/**
* 表格孪生：每个键的完整读数，可复制（14 文档 §4.4）。
*
* 键盘/3D 画布都没有一条能让屏幕阅读器逐键读出读数的路径，这张折叠表补上它，同时
* 兜住"键面数值印不下"与"3D 键帽上没有数字"两种场景。
*/
function KeyTable({ values, metric }) {
	const definition = metricOf(metric);
	const read = (entry) => Number(entry[metric]) || 0;
	const list = [...values.values()].filter((entry) => read(entry) > 0).sort((a, b) => read(b) - read(a));
	if (!list.length) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", {
		className: "keyboard-table",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: "表格视图" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "keyboard-table__scroll",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
				className: "table",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "键位" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "次数" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "占比" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: "均时长" })
				] }) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: list.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: entry.label || entry.id }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
						className: "numeric",
						children: definition.format(read(entry))
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
						className: "numeric",
						children: formatPercent(entry.percent)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
						className: "numeric",
						children: formatMetric("duration_avg_ms", entry.duration_avg_ms)
					})
				] }, entry.id)) })]
			})
		})]
	});
}
//#endregion
//#region frontend/src/components/KeyboardShowcase.tsx
var Keyboard3D$1 = (0, import_react.lazy)(() => __vitePreload(() => import("./Keyboard3D-BTiLW2xg.js").then((module) => ({ default: module.Keyboard3D })), __vite__mapDeps([0,1,2,3,4,5,6])));
/** 数据毫秒 / 真实秒。中速 4 秒一天，与参考视频接近。 */
var RATES = {
	slow: 108e5,
	normal: 216e5,
	fast: 576e5
};
var RHYTHMS = [
	{
		id: "slow",
		name: "慢"
	},
	{
		id: "normal",
		name: "中"
	},
	{
		id: "fast",
		name: "快"
	}
];
function dateLabel(iso) {
	return iso || "";
}
function KeyboardShowcase({ onClose }) {
	const identity = (useSlice("prefs").showcaseId || "").trim();
	const [status, setStatus] = (0, import_react.useState)("loading");
	const [data, setData] = (0, import_react.useState)(null);
	const [note, setNote] = (0, import_react.useState)("");
	const [playing, setPlaying] = (0, import_react.useState)(true);
	const [rhythm, setRhythm] = (0, import_react.useState)("normal");
	const [seek, setSeek] = (0, import_react.useState)(null);
	const [tick, setTick] = (0, import_react.useState)(null);
	/** 放到结尾时把控制条切回"重播"（稳定引用：它进 `stage` 的 memo 依赖）。 */
	const endAtTail = (0, import_react.useCallback)(() => setPlaying(false), []);
	(0, import_react.useEffect)(() => {
		let cancelled = false;
		(async () => {
			try {
				const payload = await get("/keyboard/press-stream");
				if (cancelled) return;
				if (!payload?.available) {
					setNote("设置里没有开启「保存原始按键事件」，拿不到逐次记录");
					setStatus("empty");
					return;
				}
				const decoded = decodePressStream(payload);
				if (!decoded) {
					setNote("这段时间还没有可放的按键记录");
					setStatus("empty");
					return;
				}
				setData(decoded);
				setStatus("ready");
			} catch {
				if (!cancelled) {
					setNote("按键流加载失败");
					setStatus("error");
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);
	(0, import_react.useEffect)(() => {
		const onKey = (event) => {
			if (event.key === "Escape") onClose();
		};
		const previous = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("keydown", onKey);
			document.body.style.overflow = previous;
		};
	}, [onClose]);
	const source = (0, import_react.useMemo)(() => data ? {
		data,
		rate: RATES[rhythm],
		playing,
		seek
	} : null, [
		data,
		rhythm,
		playing,
		seek
	]);
	const stage = (0, import_react.useMemo)(() => source ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Keyboard3D$1, {
		heatmap: null,
		metric: "press_count",
		mode: "heat",
		stream: source,
		onStreamTick: setTick,
		onStreamEnd: endAtTail
	}) : null, [source, endAtTail]);
	const span = data?.spanMs || 1;
	const offset = Math.min(span, Math.max(0, tick?.offsetMs ?? 0));
	const progress = offset / span;
	const atEnd = offset >= span - 1;
	const toggle = () => {
		if (!data) return;
		if (!playing && atEnd) {
			setTick(null);
			setSeek(0);
			setPlaying(true);
			return;
		}
		setPlaying((value) => !value);
	};
	const seekTo = (ratio) => {
		if (!data) return;
		setSeek(Math.max(0, Math.min(1, ratio)) * data.spanMs);
		setPlaying(true);
	};
	const day = (tick?.dayIndex ?? 0) + 1;
	const date = tick?.date || data?.from || "";
	return (0, import_react_dom.createPortal)(/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "showcase",
		role: "dialog",
		"aria-modal": "true",
		"aria-label": "键盘时间流逝",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "showcase__top",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
					className: "showcase__hud",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "showcase__date",
							children: dateLabel(date)
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "showcase__day",
							children: [
								"第 ",
								day,
								" 天"
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "showcase__total",
							children: formatCount(tick?.total ?? 0)
						})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
					className: "showcase__aside",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "showcase__caption",
						children: "个人日常键盘使用频次数据可视化"
					}), identity ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "showcase__id",
						children: identity
					}) : null]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "showcase__stage",
				children: [status === "ready" && stage ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_react.Suspense, {
					fallback: null,
					children: stage
				}) : null, status !== "ready" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "showcase__veil",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: status === "loading" ? "正在读取按键记录…" : note }), status === "loading" ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "showcase__button",
						onClick: onClose,
						children: "关闭"
					})]
				}) : null]
			}),
			status === "ready" && data ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("footer", {
				className: "showcase__bar",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "showcase__button",
						onClick: toggle,
						children: playing ? "暂停" : atEnd ? "重播" : "继续"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Segmented, {
						items: RHYTHMS,
						active: rhythm,
						onPick: (id) => setRhythm(id),
						small: true,
						label: "播放节奏"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "showcase__track",
						"aria-label": "进度，点击跳到任意时刻",
						onClick: (event) => {
							const rect = event.currentTarget.getBoundingClientRect();
							seekTo((event.clientX - rect.left) / Math.max(1, rect.width));
						},
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { style: { width: `${(progress * 100).toFixed(2)}%` } })
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: "showcase__range",
						children: [
							data.from,
							" → ",
							data.to
						]
					}),
					data.truncated ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "showcase__hint",
						children: "只放了前 200 万次"
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "showcase__button",
						onClick: onClose,
						children: "退出"
					})
				]
			}) : null
		]
	}), document.body);
}
//#endregion
//#region frontend/src/components/ReplayBar.tsx
/**
* 回放控件（14 文档）。**2D 与 3D 共用同一个**——它在视图层渲染一次，两条渲染路径都
* 只通过总线订阅 `key:press`，因此这里不需要知道当前是哪种视图。
*
* 三个按钮而不是一个循环按钮：回放中途停下是常见动作（"我只想看看开头那几百次"），
* 而「暂停」并不能把键面还回今天的读数——它停的是时钟，不是读数。没有「停止」的话，
* 想回到正常数字只能离开这个视图，用户 2026-10-31 为此绕了三步（切平面 → 切页面 →
* 切回来），还踩上了切回来是空白画布那个 bug。所以这里多给一个显式的出口。
*
* **倍速条**（2026-10-31 追加）：这一天的总时长有一个地板——每颗键至少 `MIN_GAP_MS`，
* 于是一万次按下至少 6.7 分钟，用户反馈"太慢"。地板是为了让顺序看得见，不能直接拆，
* 就把选择权交给滑条：0.5× 用来盯细节，4× 用来快速过一遍（代价是一帧里同亮几颗键）。
* 速率写进 localStorage，下次打开还是这个档——它是播放习惯，不该每次重新调。
*/
function ReplayBar() {
	const state = (0, import_react.useSyncExternalStore)(subscribe, getReplay);
	const busy = state.status === "loading";
	const active = state.status === "playing" || state.status === "paused";
	const label = busy ? "加载中…" : state.status === "playing" ? "暂停回放" : state.status === "paused" ? "继续回放" : "播放今天";
	const percent = state.total ? Math.round(state.done / state.total * 100) : 0;
	/** 拇指位置 0..1：CSS 用它切轨道那一段已过的颜色（见 key-cap.css）。 */
	const position = (state.rate - MIN_RATE) / (4 - MIN_RATE);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "keyboard-replay",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				onClick: toggle,
				disabled: busy,
				children: label
			}),
			active ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				onClick: stop,
				children: "停止"
			}) : null,
			state.total > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "keyboard-replay__progress",
				role: "progressbar",
				"aria-valuemin": 0,
				"aria-valuemax": state.total,
				"aria-valuenow": state.done,
				"aria-label": "回放进度",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { style: { width: `${percent}%` } })
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "keyboard-replay__count",
				children: [
					state.done,
					"/",
					state.total
				]
			})] }) : null,
			state.status === "empty" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "今天没有可回放的顺序记录" }) : null,
			state.status === "error" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "回放加载失败" }) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "keyboard-replay__rate",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
						htmlFor: "replay-rate",
						children: "倍速"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
						id: "replay-rate",
						type: "range",
						min: MIN_RATE,
						max: 4,
						step: RATE_STEP,
						value: state.rate,
						onChange: (event) => setRate(Number(event.target.value)),
						style: { "--rate": position }
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "keyboard-replay__rate-value",
						onClick: () => setRate(1),
						title: "回到 1 倍速",
						"aria-label": `当前 ${formatRate(state.rate)}，点一下回到 1 倍速`,
						children: formatRate(state.rate)
					})
				]
			})
		]
	});
}
//#endregion
//#region frontend/src/domain/buckets.ts
/**
* **泛型而不是收 `TrendBucket`**：键盘时间线的桶（`KeyTimelineBucket`）没有
* seconds / presses / categories，而它同样要标缺口。写成泛型之后调用点不必 `as`
* 一下——那种转型会把"这里的类型其实对不上"这件事藏起来。
*/
function markGaps(buckets, granularity, gaps, period) {
	if (!buckets?.length || !gaps || gaps.size === 0) return [...buckets || []];
	if (granularity === "hour") {
		const day = period?.start || period?.anchor;
		const missing = Boolean(day && gaps.has(day));
		return buckets.map((bucket) => missing ? {
			...bucket,
			gap: true
		} : bucket);
	}
	return buckets.map((bucket) => {
		return (granularity === "day" ? gaps.has(bucket.bucket) : bucketCoversGap(bucket.bucket, gaps)) ? {
			...bucket,
			gap: true
		} : bucket;
	});
}
//#endregion
//#region frontend/src/views/keyboard.tsx
var title = "键盘";
var TOP_KEYS = 10;
var GRAIN_NAMES = {
	hours: "小时",
	days: "天",
	months: "月",
	years: "年"
};
/** markGaps 用的桶粒度命名（它按 hour/day/month/year 判断缺口映射）。 */
var GAP_GRAIN = {
	hours: "hour",
	days: "day",
	months: "month",
	years: "year"
};
var DENSITIES = [{
	id: "standard",
	name: "标准"
}, {
	id: "compact",
	name: "紧凑"
}];
var SURFACES = [{
	id: "3d",
	name: "3D"
}, {
	id: "flat",
	name: "平面"
}];
var LOOKS = [{
	id: "heat",
	name: "日常"
}, {
	id: "showcase",
	name: "展示"
}];
/** three 只在真的切到 3D 时才加载（`vite` 会把下面这个动态导入拆成单独的 chunk）。 */
var Keyboard3D = (0, import_react.lazy)(() => __vitePreload(() => import("./Keyboard3D-BTiLW2xg.js").then((module) => ({ default: module.Keyboard3D })), __vite__mapDeps([0,1,2,3,4,5,6])));
var FORMS = [{
	id: "bars",
	name: "柱状"
}, {
	id: "heat",
	name: "热力"
}];
function defaultForm(grain) {
	return grain === "days" ? "heat" : "bars";
}
/** 布局族：auto 时不传 family，让后端按平台默认值决定（05 文档 §7）。 */
function familyParam(state) {
	const requested = state.prefs.keyboardLayout;
	return requested && requested !== "auto" ? { family: requested } : {};
}
function needs(state) {
	const period = periodParams(state.period);
	const scope = state.scopeAppId ? { app_id: state.scopeAppId } : {};
	const requests = [
		{
			key: "layout",
			path: "/keyboard/layout",
			params: familyParam(state)
		},
		{
			key: "heatmap",
			path: "/keyboard/heatmap",
			params: {
				...period,
				metric: state.metric,
				...scope
			}
		},
		{
			key: "timeline",
			path: "/keyboard/timeline",
			params: {
				...period,
				view: "hours,days,months,years",
				metric: state.metric,
				...scope
			}
		},
		{
			key: "ergonomics",
			path: "/keyboard/ergonomics",
			params: {
				...period,
				...scope
			}
		},
		{
			key: "appsMeta",
			path: "/apps",
			params: { limit: 300 }
		},
		{
			key: "appsRunning",
			path: "/apps/running"
		}
	];
	if (state.selectedKeyId) requests.push({
		key: "keyDetail",
		path: `/keyboard/keys/${state.selectedKeyId}`,
		params: {
			...period,
			...scope
		}
	});
	return requests;
}
function reload() {
	const state = getState();
	for (const request of needs(state)) fetchInto(request.key, request.path, request.params);
}
function Bar({ ratio }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "bar",
		style: { "--fill": Math.max(0, Math.min(1, ratio || 0)) },
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {})
	});
}
function View() {
	const metric = useSlice("metric");
	const capabilities = useSlice("capabilities");
	const degraded = useSlice("degraded");
	const selectedKeyId = useSlice("selectedKeyId");
	const layout = useResource("layout");
	const heatmap = useResource("heatmap");
	const appsMeta = useResource("appsMeta");
	const appsRunning = useResource("appsRunning");
	const [density, setDensity] = (0, import_react.useState)("standard");
	const [surface, setSurface] = (0, import_react.useState)(() => webglAvailable() ? "3d" : "flat");
	const [look, setLook] = (0, import_react.useState)("heat");
	const [showcase, setShowcase] = (0, import_react.useState)(false);
	const [grain, setGrain] = (0, import_react.useState)("days");
	const [form, setForm] = (0, import_react.useState)(null);
	const shownForm = form ?? defaultForm(grain);
	const metricSlot = document.getElementById(METRIC_SLOT_ID);
	const error = heatmap.error || layout.error;
	const keyboardOk = capabilityOf(capabilities, "keyboard");
	const notice = noticeFor(degraded, "keyboard");
	(0, import_react.useEffect)(() => () => stop(), []);
	const keyValues = new Map((heatmap.data?.keys || []).map((key) => [key.id, key]));
	const [modelKeyIds, setModelKeyIds] = (0, import_react.useState)(null);
	const absentFromModel = modelKeyIds ? (heatmap.data?.keys || []).reduce((count, key) => modelKeyIds.has(key.id) ? count : count + 1, 0) : 0;
	const selectKey = (keyId) => {
		setState("selectedKeyId", keyId);
		loadKeyDetail(keyId);
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
			className: "view__title sr-only",
			tabIndex: -1,
			id: "view-title",
			children: "键盘"
		}),
		metricSlot ? (0, import_react_dom.createPortal)(/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Segmented, {
			items: METRICS,
			active: metric,
			onPick: (id) => setState("metric", id),
			variant: "switch",
			label: "统计指标"
		}), metricSlot) : null,
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
			title: "按键跟踪",
			sub: "只统计键位次数，不保存输入内容",
			lead: true,
			right: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "keyboard-view__scope",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AppPicker, {
					apps: appsMeta.data?.apps,
					runningIds: (appsRunning.data?.apps || []).map((app) => app.app_id).filter((id) => typeof id === "number")
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Updated, {})]
			}),
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Card, {
				title: "键盘热力图",
				subtitle: "颜色由冷到暖，使用次数越多",
				controls: keyboardOk ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(HeatLegend, {
						metric,
						scale: heatmap.data?.scale
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Segmented, {
						items: SURFACES,
						active: surface,
						onPick: (id) => {
							stop();
							setSurface(id);
						},
						small: true,
						label: "键盘渲染方式"
					}),
					surface === "3d" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Segmented, {
						items: LOOKS,
						active: look,
						onPick: (id) => setLook(id),
						small: true,
						label: "3D 观感"
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						className: "button",
						onClick: () => {
							stop();
							setShowcase(true);
						},
						children: "时间流逝"
					}),
					surface === "flat" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Segmented, {
						items: DENSITIES,
						active: density,
						onPick: (id) => setDensity(id),
						small: true,
						label: "键盘密度"
					}) : null
				] }) : null,
				footer: keyboardOk && heatmap.data ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Totals, { heatmap: heatmap.data }) : null,
				children: !keyboardOk ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CapabilityNotice, {
					title: notice?.title || "当前环境无法采集键盘",
					detail: notice?.detail || "应用时长统计不受影响。",
					hint: notice?.hint || ""
				}) : error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ErrorState, {
					message: error.message,
					onRetry: reload
				}) : !layout.data || !heatmap.data ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SkeletonRows, { count: 1 }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
					surface === "3d" && !showcase ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_react.Suspense, {
						fallback: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SkeletonRows, { count: 1 }),
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Keyboard3D, {
							heatmap: heatmap.data,
							metric,
							mode: look,
							onSelectKey: selectKey,
							onKeysLoaded: (ids) => setModelKeyIds(new Set(ids))
						})
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(KeyboardView, {
						layout: layout.data,
						heatmap: heatmap.data,
						metric,
						density,
						onSelectKey: selectKey
					}),
					surface === "3d" && absentFromModel > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "card__hint",
						children: [
							"3D 模型是全尺寸 ANSI 104，当前布局里有 ",
							absentFromModel,
							" 个键位不在模型上， 读数见下方表格视图"
						]
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ReplayBar, {}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Orphans, {
						keys: heatmap.data.orphan_keys,
						metric
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(KeyTable, {
						values: keyValues,
						metric
					})
				] })
			})
		}),
		selectedKeyId ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(KeyDetail, { keyId: selectedKeyId }) : null,
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
			title: "时间分布",
			sub: `按${GRAIN_NAMES[grain]}聚合 · ${metricName(metric)}`,
			right: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "keyboard-view__scope",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Segmented, {
					items: TIMELINE_VIEWS,
					active: grain,
					onPick: (id) => setGrain(id),
					small: true,
					label: "时间尺度"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Segmented, {
					items: FORMS,
					active: shownForm,
					onPick: (id) => setForm(id),
					small: true,
					label: "展示形式"
				})]
			}),
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "card",
				children: shownForm === "heat" ? grain === "days" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Calendar, {}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HeatScale, { grain }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ScaleBars, { grain })
			})
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "grid grid--2",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Card, {
				title: `高频键位 Top ${TOP_KEYS}`,
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "top-keys",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TopKeys, {
						heatmap: heatmap.data,
						metric
					})
				})
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Card, {
				title: "手指负荷",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Ergonomics, {})
			})]
		}),
		showcase ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(KeyboardShowcase, { onClose: () => setShowcase(false) }) : null
	] });
}
function metricName(metric) {
	return METRICS.find((item) => item.id === metric)?.name || "";
}
/**
* 单键详情的取数。带上 scope：范围切到某个应用时，热图是那个应用的，单键详情也必须
* 是——现状这个请求不带 app_id，于是热图与详情来自两个不同的口径，界面上没有任何
* 提示（14 文档 §2.8）。
*/
function loadKeyDetail(keyId) {
	const state = getState();
	const scope = state.scopeAppId ? { app_id: state.scopeAppId } : {};
	fetchInto("keyDetail", `/keyboard/keys/${keyId}`, {
		...periodParams(state.period),
		...scope
	});
}
/** 四格总计。几何来自 KeyTrace 应用屏的四格摘要，不是原先那一行裸文字（17 文档 §4.3）。 */
function Totals({ heatmap }) {
	const totals = heatmap.totals;
	const scope = heatmap.scope;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "keyboard-totals",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Quad, { items: [
			{
				label: "按键次数",
				value: formatCount(totals?.press_count || 0)
			},
			{
				label: "活跃键位",
				value: `${totals?.active_keys || 0} 个`
			},
			{
				label: "平均时长",
				value: formatMetric("duration_avg_ms", totals?.duration_avg_ms || 0)
			},
			{
				label: "最长按压",
				value: formatMetric("duration_max_ms", totals?.duration_max_ms || 0)
			}
		] }), scope?.type === "app" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "card__hint",
			children: ["范围：", scope.display_name || ""]
		}) : null]
	});
}
function TopKeys({ heatmap, metric }) {
	if (!heatmap) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SkeletonRows, { count: 3 });
	const read = (key) => Number(key[metric]) || 0;
	const keys = (heatmap.keys || []).filter((key) => read(key) > 0).sort((left, right) => read(right) - read(left)).slice(0, TOP_KEYS);
	if (!keys.length) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, {
		title: "这段时间没有按键记录",
		mark: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, {
			name: "keyboard",
			size: 28
		})
	});
	const top = read(keys[0]) || 1;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: keys.map((key, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "top-key",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "rank",
				children: index + 1
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "top-key__label",
				children: key.label
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Bar, { ratio: read(key) / top }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "top-key__count",
				children: formatMetric(metric, read(key))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "top-key__percent",
				children: formatPercent(key.percent)
			})
		]
	}, key.id)) });
}
/**
* 小时 / 月 / 年的热力格形式。与 :func:`ScaleBars` 读的是同一个 `timeline` 资源、同一个
* 指标、同一套缺口标记——**只有画法不同**，因此两种形式之间切换不会出现"两张图对不上"。
*
* 日尺度不走这里：那一档的热力形式就是年历（`Calendar`），它是二维的。
*/
function HeatScale({ grain }) {
	const metric = useSlice("metric");
	const coverage = useSlice("coverage");
	const { data: payload, loading } = useResource("timeline");
	if (!payload) return loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SkeletonRows, { count: 1 }) : null;
	const view = payload.views?.[grain];
	if (!view || view.available === false) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TimelineUnavailable, { payload });
	const gaps = gapSet(coverage, ["keyboard"]);
	const definition = metricOf(metric);
	const marked = markGaps(view.buckets, GAP_GRAIN[grain], gaps, view.period);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(HeatStrip, {
		buckets: marked.map((bucket) => ({
			bucket: bucket.bucket,
			label: bucket.label,
			value: Number(bucket[metric]) || 0,
			gap: bucket.gap
		})),
		scale: view.scale,
		valueLabel: definition.name,
		format: (value) => formatMetric(metric, value),
		label: `按${GRAIN_NAMES[grain]}的${definition.name}`
	}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(GapLegend, { count: gaps.size })] });
}
/** 「该视图在当前设置下不可用」。两种形式共用一份措辞：说两遍就会有一天只改了一遍。 */
function TimelineUnavailable({ payload }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CapabilityNotice, {
		title: "该视图在当前设置下不可用",
		detail: payload.warnings?.[0]?.message || "按小时的分布需要保留原始按键事件。",
		hint: "设置中开启\"保存原始按键事件\"后，此后的数据可用"
	});
}
/**
* 小时 / 月 / 年：一根轴上的一组柱。三个尺度共用这一个组件——它们都是一维序列，
* 差别只在桶数（24 / 12 / 若干）与标签。
*
* `available: false` 是"该视图在当前设置下拿不到"，不是"值为 0"。原始事件被关掉时
* 按小时的分布就属于这一类（services/keyboard.py 的 _hours_view）。
*/
function ScaleBars({ grain }) {
	const metric = useSlice("metric");
	const coverage = useSlice("coverage");
	const { data: payload, loading } = useResource("timeline");
	if (!payload) return loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SkeletonRows, { count: 1 }) : null;
	const view = payload.views?.[grain];
	if (!view || view.available === false) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TimelineUnavailable, { payload });
	const gaps = gapSet(coverage, ["keyboard"]);
	const definition = metricOf(metric);
	const format = (value) => formatMetric(metric, value);
	const data = {
		buckets: markGaps(view.buckets, GAP_GRAIN[grain], gaps, view.period).map((bucket) => ({
			bucket: bucket.bucket,
			label: bucket.label,
			value: Number(bucket[metric]) || 0,
			gap: bucket.gap
		})),
		valueLabel: definition.name,
		caption: `按${GRAIN_NAMES[grain]}的${definition.name}`,
		summary: `按${GRAIN_NAMES[grain]}的${definition.name}，共 ${view.buckets.length} 个桶`
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "chart chart--scale",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Chart, {
			data,
			draw: scaleBarsDraw({
				format,
				accent: "keys"
			}),
			describe: scaleBarsDescribe({ format }),
			height: 190,
			label: data.summary,
			onHover: showChartTooltip,
			onLeave: hideChartTooltip
		})
	}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(GapLegend, { count: gaps.size })] });
}
/**
* 「日」这一档。365 天是**二维**的（7 行 × 53 列），因此它是日历而不是柱：一年 365 根
* 柱各占 2px，看不出星期与月份的位置，而"周末在不在打字"恰是这个尺度上最该看出的事
* （14 文档 §2.11 / §5.2）。月份轴与星期轴也是我们比两个前身都强的地方。
*/
function Calendar() {
	const coverage = useSlice("coverage");
	const prefs = useSlice("prefs");
	const metric = useSlice("metric");
	const { data: payload, loading } = useResource("timeline");
	const view = payload?.views?.days;
	if (!view) return loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SkeletonRows, { count: 1 }) : null;
	if (view.available === false) return null;
	const gaps = gapSet(coverage, ["keyboard"]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CalendarHeatmap, {
		buckets: view.buckets,
		scale: view.scale,
		gaps,
		weekStartsOn: prefs.weekStartsOn,
		metric
	}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(GapLegend, { count: gaps.size })] });
}
function Ergonomics() {
	const capabilities = useSlice("capabilities");
	const { data: payload, loading } = useResource("ergonomics");
	if (!payload) return loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SkeletonRows, { count: 3 }) : null;
	const hands = payload.hands;
	const left = Number(hands?.left) || 0;
	const right = Number(hands?.right) || 0;
	const both = left + right;
	const fingers = payload.fingers || [];
	const top = Math.max(1, ...fingers.map((finger) => Number(finger.press_count) || 0));
	const rows = payload.rows || [];
	const rowTop = Math.max(1, ...rows.map((row) => Number(row.press_count) || 0));
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "hands",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["左手 ", formatPercent(both ? left / both * 100 : 0)] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "hands__bar",
					style: { "--left": both ? left / both : .5 },
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["右手 ", formatPercent(both ? right / both * 100 : 0)] })
			]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "fingers",
			children: fingers.map((finger) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "finger-row",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "finger-row__name",
						children: finger.name
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Bar, { ratio: (Number(finger.press_count) || 0) / top }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "finger-row__percent",
						children: formatPercent(finger.percent)
					})
				]
			}, finger.id || finger.name))
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "text-sm muted",
			children: "行分布"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "fingers",
			children: rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "finger-row",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "finger-row__name",
						children: row.name
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Bar, { ratio: (Number(row.press_count) || 0) / rowTop }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "finger-row__percent",
						children: formatPercent(row.percent)
					})
				]
			}, row.id || row.name))
		}),
		payload.modifier_ratio ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "card__hint",
			children: [
				"修饰键占比 ",
				formatPercent(payload.modifier_ratio.percent),
				"，口径：修饰键自身被按下的次数"
			]
		}) : null,
		capabilityOf(capabilities, "key_position_stable") ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "card__hint",
			children: "当前后端无法区分左右修饰键，左右手分布仅供参考"
		})
	] });
}
function KeyDetail({ keyId }) {
	const { data: payload } = useResource("keyDetail");
	if (!payload || payload.key.id !== keyId) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Card, {
		title: "键位详情",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SkeletonRows, { count: 2 })
	});
	const key = payload.key;
	const totals = payload.totals;
	const byApp = payload.by_app || [];
	const scope = payload.scope;
	const top = Math.max(1, ...byApp.map((item) => Number(item.press_count) || 0));
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Card, {
		title: `键位详情：${key.label}`,
		controls: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
			className: "button",
			type: "button",
			onClick: () => setState("selectedKeyId", null),
			children: "关闭"
		}),
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "stack",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "card__hint",
					children: scope?.type === "app" ? `范围：${scope.display_name || ""}` : "范围：全部应用"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", {
					className: "kv-list",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "按下次数" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: formatCount(totals?.press_count || 0) }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "平均时长" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: formatMetric("duration_avg_ms", totals?.duration_avg_ms || 0) }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "手指" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: key.finger_name || "-" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "所在行" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: key.row_name || "-" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: "在当前布局中" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: key.in_layout ? "是" : "否" })
					]
				}),
				byApp.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "key-app-split",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "text-sm muted",
						children: "主要来自这些应用"
					}), byApp.slice(0, 8).map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "top-key",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "rank" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "truncate",
								children: item.display_name
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Bar, { ratio: (Number(item.press_count) || 0) / top }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "top-key__count",
								children: formatCount(item.press_count)
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "top-key__percent",
								children: formatPercent(item.percent)
							})
						]
					}, item.app_id))]
				}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "card__hint",
					children: "这个键没有按应用拆分的数据"
				})
			]
		})
	});
}
//#endregion
export { View, needs, title };
