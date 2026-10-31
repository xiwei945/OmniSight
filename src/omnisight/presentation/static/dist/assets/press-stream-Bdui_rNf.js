import { H as _defineProperty, I as get, U as emit } from "./degraded-CHoep9Ns.js";
//#region frontend/src/core/counts.ts
/**
* 95 分位，只统计大于 0 的值。空集返回 1，避免调用方除零。
*
* 为什么是 p95 而不是 max：一个 Space 就能把其余键压成同一档色（06 文档 §7）。
*/
function p95OfCounts(values) {
	const positive = [];
	for (const value of values) if (value > 0) positive.push(value);
	if (!positive.length) return 1;
	positive.sort((left, right) => left - right);
	const position = Math.min(positive.length - 1, Math.floor(positive.length * .95));
	return Math.max(1, positive[position]);
}
//#endregion
//#region frontend/src/core/replay-counts.ts
/** 一次遍历把整段事件累加成每键的账。 */
function tally(events) {
	const totals = /* @__PURE__ */ new Map();
	for (const event of events) {
		let acc = totals.get(event.key_id);
		if (!acc) {
			acc = {
				count: 0,
				sumMs: 0,
				maxMs: 0
			};
			totals.set(event.key_id, acc);
		}
		acc.count += 1;
		const held = Number.isFinite(event.d) ? Math.max(0, event.d) : 0;
		acc.sumMs += held;
		if (held > acc.maxMs) acc.maxMs = held;
	}
	return {
		totals,
		events: events.length
	};
}
/**
* 累计量 → 当前 metric 的读数。
*
* metric id 与 `domain/metrics.ts` 的 `METRICS` 一一对应；未知 id 按次数处理——
* 宁可显示一个能读的数字，也不要让键面空着。
*/
function valueOfMetric(metric, acc) {
	switch (metric) {
		case "duration_total_ms": return acc.sumMs;
		case "duration_avg_ms": return acc.count > 0 ? acc.sumMs / acc.count : 0;
		case "duration_max_ms": return acc.maxMs;
		default: return acc.count;
	}
}
/**
* 色阶分母：整段回放**终值**在该 metric 下的 p95。
*
* 用终值而不是"当前这一帧的最大值"：后者会让颜色每帧重新归一，一颗键刚变深又被
* 后来的键压回去，看的人只会觉得"颜色在乱跳"。用终值，颜色只朝一个方向走。
*/
function p95OfMetric(metric, tally) {
	const values = [];
	for (const acc of tally.totals.values()) values.push(valueOfMetric(metric, acc));
	return p95OfCounts(values);
}
//#endregion
//#region frontend/src/core/replay.ts
/** 整体回放时长目标。几万次按键也在这个量级放完。 */
var TARGET_MS = 3e4;
/** 上限：极长或极稀疏的一天也别放成十分钟。超出的间隔按这个封顶。 */
var MAX_GAP_MS = 900;
/**
* 下限：相邻两颗键在屏幕上的最短间隔。
*
* **这个数就是"顺序看得见"本身**：原来是 6ms，远小于一帧（16.7ms），于是一帧内到期的
* 按键全被同一次 rAF 发出去——画面上是"整块键盘同时闪"，而不是 d→w→a→s。40ms 约 2.4 帧，
* 一颗接一颗才读得出来；再快就只剩一糊。
*/
var MIN_GAP_MS = 40;
/** 单帧最多推进多少毫秒。切后台回来时用它把"错过的几个小时"夹掉。 */
var MAX_FRAME_MS = 100;
/**
* 倍速范围与档距。
*
* **为什么需要它**：`MIN_GAP_MS` 是每颗键的下限，于是这一天的总时长至少是
* `(N-1) × 40ms`——一万次按下就是 6.7 分钟，`TARGET_MS` 那个"压到 30 秒"的目标根本
* 轮不到它说话（下限赢）。所以"太慢"不是压缩系数算错了，是这条路本身有个地板；
* 想更快只能显式地跨过地板，也就是倍速。
*/
var MIN_RATE = .5;
/** 档距。滑条按它吸附，`clampRate` 也按它取整，两者才不会给出对不上的值。 */
var RATE_STEP = .25;
var RATE_KEY = "omnisight.replayRate";
/** 夹到 `[MIN_RATE, MAX_RATE]` 并对齐档距。非法值（NaN、localStorage 里被人写坏）回 1。 */
function clampRate(value) {
	if (!Number.isFinite(value)) return 1;
	const snapped = Math.round(value / RATE_STEP) * RATE_STEP;
	return Math.min(4, Math.max(MIN_RATE, Number(snapped.toFixed(2))));
}
/** `1×` / `0.75×`：整数不带小数点，其余去掉末尾的 0。 */
function formatRate(rate) {
	return `${rate.toFixed(2).replace(/\.?0+$/, "")}×`;
}
/** 倍速跟着这台浏览器走（像主题那样），不进配置：它是**播放方式**，不是一条应用设置。 */
function readRate() {
	try {
		if (typeof localStorage === "undefined") return 1;
		const raw = localStorage.getItem(RATE_KEY);
		return raw == null ? 1 : clampRate(Number(raw));
	} catch {
		return 1;
	}
}
function writeRate(rate) {
	try {
		if (typeof localStorage === "undefined") return;
		localStorage.setItem(RATE_KEY, String(rate));
	} catch {}
}
/** 倍速不随 status 重置，所以它不放在 state 里被各处覆写，而是由 `setState` 统一带上。 */
var rate = readRate();
var state = {
	status: "idle",
	total: 0,
	done: 0,
	rate
};
var listeners = /* @__PURE__ */ new Set();
var events = [];
/** 每条事件的**虚拟触发时刻**（毫秒），在装载时一次算好。 */
var schedule = [];
var cursor = 0;
/** 装载时算出的整段缩放系数（`TARGET_MS` 那一档）。与用户可调的 `rate` 无关。 */
var spanScale = 1;
var raf = 0;
/** 这一份回放的账（每键累计 + 色阶分母需要的终值）。`run` 每次开播自增。 */
var meta = null;
var runSeq = 0;
/**
* 虚拟时钟。**累加**而不是"起点 + 墙钟差"：后者的写法在标签页切后台时，rAF 停摆
* 几分钟回来，`now - wallBase` 一次跳掉几分钟，一帧里把几千颗键全发出去——画面成了
* 一次闪光，顺序也就没了。累加式每帧最多认 100ms。
*/
var elapsed = 0;
var lastFrameAt = 0;
/** 上一次把进度写进 state 的时刻。进度条不需要 60fps，节流到 5Hz。 */
var lastReport = 0;
function notify() {
	for (const listener of [...listeners]) listener(state);
}
/** 调用方只给"这一段变了什么"，倍速由这里统一补上——否则每次改 status 都会把它抹掉。 */
function setState(next) {
	state = {
		...next,
		rate
	};
	notify();
}
function getReplay() {
	return state;
}
/**
* 改倍速。**播放中改立刻生效**：`frame()` 每帧读的是当前值，不重建时间轴，
* 所以已经放出去的部分不会跳、不会重算，只是从现在开始走得快/慢一点。
*/
function setRate(value) {
	const next = clampRate(value);
	if (next === rate) return rate;
	rate = next;
	state = {
		...state,
		rate
	};
	writeRate(rate);
	notify();
	return rate;
}
/**
* 这一份回放的累计账；没有在放（或还没装载完）时是 `null`。
*
* 给 3D 场景用：它要在回放过程中把键面数字从 0 累加上去，而"每个键最后会到多少"
* 决定了色阶分母（见 `core/replay-counts.ts:p95OfMetric`）。
*/
function getReplayMeta() {
	return meta;
}
/** @returns 注销函数 */
function subscribe(listener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
function today() {
	const now = /* @__PURE__ */ new Date();
	const offset = now.getTimezoneOffset() * 6e4;
	return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}
/**
* 把带时间戳的事件压成一条**虚拟时间轴**：先算整段的缩放系数（总时长压到 `TARGET_MS`），
* 再把每个间隔夹到 `[MIN_GAP_MS, MAX_GAP_MS]` 后累加。夹完再累加，而不是先累加再夹——
* 后者会让封顶的那一段之后所有事件整体前移，与真实顺序错位。
*/
function buildSchedule(list) {
	schedule = [];
	if (!list.length) return;
	const span = Math.max(0, list[list.length - 1].t - list[0].t);
	spanScale = span > TARGET_MS ? span / TARGET_MS : 1;
	let virtual = 0;
	schedule.push(0);
	for (let index = 1; index < list.length; index += 1) {
		const gap = Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, (list[index].t - list[index - 1].t) / spanScale));
		virtual += gap;
		schedule.push(virtual);
	}
}
function frame() {
	if (state.status !== "playing") return;
	const now = performance.now();
	elapsed += Math.min(MAX_FRAME_MS, Math.max(0, now - lastFrameAt)) * rate;
	lastFrameAt = now;
	while (cursor < events.length && schedule[cursor] <= elapsed) {
		const event = events[cursor];
		emit("key:press", [event.key_id]);
		emit("key:press:detail", [{
			key_id: event.key_id,
			d: event.d ?? 0
		}]);
		cursor += 1;
	}
	if (cursor >= events.length) {
		setState({
			status: "idle",
			total: events.length,
			done: events.length
		});
		return;
	}
	if (now - lastReport > 200) {
		lastReport = now;
		setState({
			...state,
			done: cursor
		});
	}
	raf = window.requestAnimationFrame(frame);
}
function cancelFrame() {
	if (raf) {
		window.cancelAnimationFrame(raf);
		raf = 0;
	}
}
async function start() {
	cancelFrame();
	if (state.status === "loading") return;
	setState({
		status: "loading",
		total: 0,
		done: 0
	});
	try {
		const payload = await get("/keyboard/replay", { date: today() });
		if (!payload.available || !payload.events?.length) {
			events = [];
			schedule = [];
			meta = null;
			setState({
				status: "empty",
				total: 0,
				done: 0
			});
			return;
		}
		events = payload.events;
		buildSchedule(events);
		runSeq += 1;
		meta = {
			run: runSeq,
			tally: tally(events)
		};
		cursor = 0;
		elapsed = 0;
		lastFrameAt = performance.now();
		lastReport = 0;
		setState({
			status: "playing",
			total: events.length,
			done: 0
		});
		raf = window.requestAnimationFrame(frame);
	} catch {
		meta = null;
		setState({
			status: "error",
			total: 0,
			done: 0
		});
	}
}
function pause() {
	if (state.status !== "playing") return;
	cancelFrame();
	setState({
		...state,
		status: "paused"
	});
}
function resume() {
	if (state.status !== "paused") return;
	lastFrameAt = performance.now();
	setState({
		...state,
		status: "playing"
	});
	raf = window.requestAnimationFrame(frame);
}
function toggle() {
	if (state.status === "playing") pause();
	else if (state.status === "paused") resume();
	else start();
}
/** 离开键盘视图时停掉，避免 rAF 在后台空转、也避免事件打到已卸载的组件上。 */
function stop() {
	cancelFrame();
	events = [];
	schedule = [];
	meta = null;
	cursor = 0;
	elapsed = 0;
	setState({
		status: "idle",
		total: 0,
		done: 0
	});
}
//#endregion
//#region frontend/src/core/press-stream.ts
/** base64 → 字节。Node 与浏览器都自带 `atob`。 */
function decodeBase64(text) {
	const binary = atob(text);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}
/**
* LEB128 增量 → 绝对偏移。
*
* **不能用位移累加**：JS 的位运算是 32 位的，一年的毫秒偏移超过 2^31，`|=` 会翻成负数，
* 于是动画会在第 25 天突然倒着走。用乘法累加，值域交给 float64。
*/
function decodeVarints(bytes, count) {
	const values = new Float64Array(count);
	let position = 0;
	let offset = 0;
	for (let index = 0; index < count; index += 1) {
		let value = 0;
		let multiplier = 1;
		for (;;) {
			const byte = bytes[position];
			position += 1;
			value += (byte & 127) * multiplier;
			if ((byte & 128) === 0) break;
			multiplier *= 128;
		}
		offset += value;
		values[index] = offset;
	}
	return values;
}
/** 键下标。`width` 为 2 时按小端 uint16 读。 */
function decodeIndices(bytes, count, width) {
	const values = new Uint16Array(count);
	if (width === 2) for (let index = 0; index < count; index += 1) values[index] = bytes[index * 2] | bytes[index * 2 + 1] << 8;
	else for (let index = 0; index < count; index += 1) values[index] = bytes[index];
	return values;
}
/** 解码整个载荷。不可用或空流返回 `null`（界面据此说"没有可放的记录"）。 */
function decodePressStream(payload) {
	if (!payload || !payload.available || !payload.count) return null;
	const times = decodeVarints(decodeBase64(payload.times), payload.count);
	const indices = decodeIndices(decodeBase64(payload.indices), payload.count, payload.index_width);
	const days = (payload.days || []).map((day) => ({
		date: day.date,
		atMs: Number(day.at_ms) || 0
	}));
	const spanMs = days.length ? days[days.length - 1].atMs + 864e5 : 0;
	const data = {
		from: payload.from,
		to: payload.to,
		startMs: payload.start_ms,
		keys: payload.keys || [],
		times,
		indices,
		days,
		count: payload.count,
		truncated: Boolean(payload.truncated),
		spanMs,
		p95: 0
	};
	data.p95 = terminalP95(data);
	return data;
}
/**
* 终值 p95。时间流逝结束时每颗键的累计次数，取 95 分位当色阶上限——这样**最后停在
* 的那一帧**跟日常热力图的档位是同一套，而不是放完只剩一片红。
*
* 分位数本体在 `core/counts.ts`：今天的回放（`replay-counts.ts`）用的是同一条规则，
* 两处各写一份的话，"同一个键在两个页面里颜色不同"是迟早的事。
*/
function terminalP95(data) {
	const counts = new Uint32Array(data.keys.length);
	for (let index = 0; index < data.count; index += 1) counts[data.indices[index]] += 1;
	return p95OfCounts(counts);
}
/** 某一时刻是第几天（0 起）。没有 `days` 时返回 0。 */
function dayIndexAt(data, offsetMs) {
	const days = data.days;
	if (!days.length) return 0;
	let low = 0;
	let high = days.length - 1;
	let found = 0;
	while (low <= high) {
		const middle = low + high >> 1;
		if (days[middle].atMs <= offsetMs) {
			found = middle;
			low = middle + 1;
		} else high = middle - 1;
	}
	return found;
}
/**
* 游标：按数据时间前进，逐条累加。
*
* 只进不退是一个刻意的约束（回放没有"倒带"的需求，倒退就 `seek`）；`seek` 会重建
* 计数，代价是 O(n)，一天最多用几次（拖进度条），不在每帧路径上。
*/
var PressCursor = class {
	constructor(data) {
		_defineProperty(this, "data", void 0);
		_defineProperty(this, "counts", void 0);
		_defineProperty(
			this,
			/**
			* 最近放出的按键下标（环形缓冲，`recentHead` 指向下一个写入位——所以**最新的那颗在
			* `recentHead - 1`**）。3D 场景按它挑"这一拍该让哪颗键帽下沉"，见 `Keyboard3D` 的
			* `startStreamPresses`。
			*
			* 为什么不直接在 `advanceTo` 里回调：一次 `advanceTo` 在 4 秒/天的速率下会放出上万次
			* 按下，逐条回调等于每帧上万次动画调度。留一个 128 的环，让渲染侧自己决定要不要、
			* 要几颗——抽样是**观感**问题，不该混进游标的数据逻辑里。
			*/
			"recent",
			/* @__PURE__ */ new Uint16Array(128)
		);
		_defineProperty(
			this,
			/** 环里已经写进去多少条（封顶到 `recent.length`）。 */
			"recentCount",
			0
		);
		_defineProperty(this, "recentHead", 0);
		_defineProperty(
			this,
			/** 当前数据时间（毫秒偏移）。 */
			"offset",
			0
		);
		_defineProperty(
			this,
			/** 已经放出的按下次数。 */
			"total",
			0
		);
		_defineProperty(this, "index", 0);
		this.data = data;
		this.counts = new Uint32Array(data.keys.length);
	}
	/** 前进到 `offsetMs`，返回这一帧新加的按下次数。 */
	advanceTo(offsetMs) {
		const { times, indices, count } = this.data;
		const { recent } = this;
		let added = 0;
		while (this.index < count && times[this.index] <= offsetMs) {
			const key = indices[this.index];
			this.counts[key] += 1;
			recent[this.recentHead] = key;
			this.recentHead = (this.recentHead + 1) % recent.length;
			if (this.recentCount < recent.length) this.recentCount += 1;
			this.index += 1;
			added += 1;
		}
		this.total += added;
		this.offset = offsetMs;
		return added;
	}
	/** 跳到某个时刻：清账重放。只在拖动进度/重播时调用。 */
	seek(offsetMs) {
		this.counts.fill(0);
		this.index = 0;
		this.total = 0;
		this.offset = 0;
		this.advanceTo(Math.max(0, offsetMs));
		this.recentCount = 0;
		this.recentHead = 0;
	}
	/** 第一条按下的偏移；用来跳过开头的空档。 */
	get firstOffset() {
		return this.data.count ? this.data.times[0] : 0;
	}
	/**
	* 下一颗还没放出来的按键（偏移）；已经放完给 `null`。
	*
	* 时间流逝用它判断"现在是空档还是真的到头了"：空档要跳过，到头了要停在结尾。
	*/
	get nextTime() {
		return this.index < this.data.count ? this.data.times[this.index] : null;
	}
};
//#endregion
export { RATE_STEP as a, getReplayMeta as c, subscribe as d, toggle as f, MIN_RATE as i, setRate as l, valueOfMetric as m, dayIndexAt as n, formatRate as o, p95OfMetric as p, decodePressStream as r, getReplay as s, PressCursor as t, stop as u };
