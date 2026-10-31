import { V as _defineProperty } from "./degraded-kEO3Hn2f.js";
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
*/
function terminalP95(data) {
	const counts = new Uint32Array(data.keys.length);
	for (let index = 0; index < data.count; index += 1) counts[data.indices[index]] += 1;
	const positive = Array.from(counts).filter((value) => value > 0).sort((left, right) => left - right);
	if (!positive.length) return 1;
	const position = Math.min(positive.length - 1, Math.floor(positive.length * .95));
	return Math.max(1, positive[position]);
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
		let added = 0;
		while (this.index < count && times[this.index] <= offsetMs) {
			this.counts[indices[this.index]] += 1;
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
	}
	/** 第一条按下的偏移；用来跳过开头的空档。 */
	get firstOffset() {
		return this.data.count ? this.data.times[0] : 0;
	}
};
//#endregion
export { dayIndexAt as n, decodePressStream as r, PressCursor as t };
