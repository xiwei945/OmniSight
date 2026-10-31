import { G as Icon, K as require_jsx_runtime, T as getState, _ as useSlice, c as formatCount, g as useResource, m as formatPercent, n as capabilityOf, r as noticeFor, u as formatDelta } from "./degraded-CHoep9Ns.js";
import { r as Updated, s as periodParams, t as fetchInto } from "./main-81ZjbgCL.js";
import { n as Section, t as Card } from "./Card-DIaFJFp4.js";
import { t as Quad } from "./Quad-BGEu9faY.js";
import { a as SkeletonRows, n as EmptyState, r as ErrorState, t as CapabilityNotice } from "./states-Qok1NqPy.js";
import { i as Chart, n as hideChartTooltip, r as showChartTooltip } from "./axis-DY4SNg7k.js";
import { n as scaleBarsDraw, t as scaleBarsDescribe } from "./scale-bars-DWjPbk9a.js";
//#region frontend/src/views/mouse.tsx
var import_jsx_runtime = require_jsx_runtime();
var title = "鼠标";
function needs(state) {
	return [{
		key: "mouse",
		path: "/mouse",
		params: periodParams(state.period)
	}];
}
function reload() {
	const state = getState();
	fetchInto("mouse", "/mouse", periodParams(state.period));
}
function View() {
	const capabilities = useSlice("capabilities");
	const degraded = useSlice("degraded");
	const { data, loading, error } = useResource("mouse");
	const mouseOk = capabilityOf(capabilities, "mouse");
	const notice = noticeFor(degraded, "mouse");
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
			className: "view__title sr-only",
			tabIndex: -1,
			id: "view-title",
			children: "鼠标"
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
			title: "鼠标",
			sub: "只统计按键次数，不记录光标位置、滚轮与移动距离",
			lead: true,
			right: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Updated, {}),
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Card, {
				title: "点击概览",
				subtitle: "这段时间里点了多少次",
				children: !mouseOk ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CapabilityNotice, {
					title: notice?.title || "当前环境无法采集鼠标",
					detail: notice?.detail || "键盘与屏幕时间统计不受影响。",
					hint: notice?.hint || ""
				}) : error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ErrorState, {
					message: error.message,
					onRetry: reload
				}) : !data ? loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SkeletonRows, { count: 2 }) : null : data.totals && data.totals.click_count > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Quad, { items: quadOf(data.totals, data.keyboard) }),
					data.totals.delta_vs_previous ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "card__hint",
						children: ["较上一周期 ", formatDelta(data.totals.delta_vs_previous)]
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ButtonSplit, { buttons: data.buttons || [] })
				] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, {
					title: "这段时间没有记录到鼠标点击",
					detail: "换一个日期，或确认托盘里的采集没有被暂停",
					mark: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, {
						name: "mouse",
						size: 28
					})
				})
			})
		}),
		mouseOk ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "grid grid--2",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Card, {
				title: "主要应用",
				subtitle: "按点击次数排序",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TopApps, {})
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Card, {
				title: "一天里的分布",
				subtitle: "按小时，本周期内合计",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Hours, {})
			})]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
			title: "点击趋势",
			sub: "少于 120 天按日，再长按月",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "card",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Trend, {})
			})
		})] }) : null
	] });
}
/** 四格读数。键鼠比是**唯一一个跨面板**的指标：它要键盘与鼠标两份数据才说得出。 */
function quadOf(totals, keyboard) {
	const ratio = keyboard?.presses_per_click;
	return [
		{
			label: "点击次数",
			value: formatCount(totals.click_count)
		},
		{
			label: "活跃天数",
			value: `${totals.active_days} 天`
		},
		{
			label: "日均点击",
			value: formatCount(Math.round(totals.per_day))
		},
		{
			label: "键鼠比",
			value: ratio === null || ratio === void 0 ? "—" : `1 : ${ratio}`
		}
	];
}
function ButtonSplit({ buttons }) {
	const top = Math.max(1, ...buttons.map((item) => Number(item.click_count) || 0));
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "mouse-buttons",
		children: buttons.map((button) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "mouse-button",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "mouse-button__label",
					children: button.label
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "bar",
					style: { "--fill": (Number(button.click_count) || 0) / top },
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {})
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "mouse-button__count",
					children: formatCount(button.click_count)
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "mouse-button__percent",
					children: formatPercent(button.percent)
				})
			]
		}, button.id))
	});
}
function TopApps() {
	const { data, loading, error } = useResource("mouse");
	if (error) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ErrorState, {
		message: error.message,
		onRetry: reload
	});
	if (!data) return loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SkeletonRows, { count: 5 }) : null;
	const apps = data.apps || [];
	if (!apps.length) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, {
		title: "这段时间没有按应用归属的点击",
		detail: "前台识别不可用时点击仍会计入总数"
	});
	const top = Math.max(1, ...apps.map((app) => Number(app.click_count) || 0));
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "mouse-apps",
		children: apps.map((app, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "mouse-app",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "rank",
					children: index + 1
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "mouse-app__name truncate",
					title: app.display_name,
					children: app.display_name
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "bar",
					style: { "--fill": (Number(app.click_count) || 0) / top },
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {})
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "mouse-app__count",
					children: formatCount(app.click_count)
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "mouse-app__percent",
					children: formatPercent(app.percent)
				})
			]
		}, app.app_id))
	});
}
function Hours() {
	const { data, loading } = useResource("mouse");
	if (!data) return loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SkeletonRows, { count: 1 }) : null;
	const hours = data.hours || [];
	if (!hours.some((hour) => (hour.click_count || 0) > 0)) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, { title: "这段时间没有按小时的点击" });
	const payload = {
		buckets: hours.map((hour) => ({
			bucket: String(hour.hour),
			label: `${hour.hour}:00`,
			value: Number(hour.click_count) || 0
		})),
		valueLabel: "点击次数",
		caption: "按小时的点击次数",
		summary: "按小时的点击次数，共 24 个桶"
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "chart chart--scale",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Chart, {
			data: payload,
			draw: scaleBarsDraw({
				format: formatCount,
				accent: "keys"
			}),
			describe: scaleBarsDescribe({ format: formatCount }),
			height: 190,
			label: payload.summary,
			onHover: showChartTooltip,
			onLeave: hideChartTooltip
		})
	});
}
function Trend() {
	const { data, loading } = useResource("mouse");
	if (!data) return loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SkeletonRows, { count: 1 }) : null;
	const timeline = data.days;
	const buckets = timeline?.buckets || [];
	if (!buckets.some((bucket) => (bucket.click_count || 0) > 0)) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, { title: "这段时间没有点击记录" });
	const byMonth = timeline?.grain === "month";
	const payload = {
		buckets: buckets.map((bucket) => ({
			bucket: bucket.bucket,
			label: bucket.label,
			value: Number(bucket.click_count) || 0
		})),
		valueLabel: "点击次数",
		caption: `按${byMonth ? "月" : "日"}的点击次数`,
		summary: `按${byMonth ? "月" : "日"}的点击次数，共 ${buckets.length} 个桶`
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "chart chart--scale",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Chart, {
			data: payload,
			draw: scaleBarsDraw({
				format: formatCount,
				accent: "keys"
			}),
			describe: scaleBarsDescribe({ format: formatCount }),
			height: 190,
			label: payload.summary,
			onHover: showChartTooltip,
			onLeave: hideChartTooltip
		})
	});
}
//#endregion
export { View, needs, title };
