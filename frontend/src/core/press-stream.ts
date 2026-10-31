// 逐次按键流：解码 + 游标（「时间流逝」动画的引擎）。
//
// 数据面在服务端（`services/press_stream.py`）：时间用 LEB128 增量、键用下标，两段
// base64。这里只做三件事：
//
//   1. 解码成**平铺的 typed array**（86 万次按下 = 7 MB Float64 + 1.7 MB Uint16），
//      不造任何对象——每帧要扫它，对象数组在这里是灾难。
//   2. `PressCursor` 按数据时间推进：每次 `advanceTo` 把这段时间内的按下逐条累加到
//      对应键上。**顺序天然就是按键发生的顺序**，所以早期稀疏段能看到 d → w → a → s
//      一颗一颗亮，密集段的数字则在飞。
//   3. 色阶的「终值 p95」在这里算一次：动画最后停在哪儿，要和日常热力图对得上，
//      所以档位阈值跟着这一段的终值走，而不是每帧重算。
//
// 纯函数 + 零 three / 零 DOM，`node --test --experimental-strip-types` 直接跑。
import { p95OfCounts } from './counts.ts';
import type { PressStreamResponse } from '../types/api.d.ts';

export interface PressStreamData {
  from: string;
  to: string;
  /** 流起点（Unix 毫秒）。 */
  startMs: number;
  /** 下标表：`indices` 里的数字指向这里。 */
  keys: string[];
  /** 每次按下的绝对毫秒偏移（相对 `startMs`），升序。 */
  times: Float64Array;
  /** 每次按下落在 `keys` 的哪一位。 */
  indices: Uint16Array;
  /** 每一天的起点（毫秒偏移），「第 N 天」与日期标签用它。 */
  days: { date: string; atMs: number }[];
  count: number;
  truncated: boolean;
  /** 整段时长（毫秒）：最后一天的 24 点。 */
  spanMs: number;
  /** 终值（累计到最后的每键次数）的 p95，色阶用它。 */
  p95: number;
}

/** base64 → 字节。Node 与浏览器都自带 `atob`。 */
export function decodeBase64(text: string): Uint8Array {
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
export function decodeVarints(bytes: Uint8Array, count: number): Float64Array {
  const values = new Float64Array(count);
  let position = 0;
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    let value = 0;
    let multiplier = 1;
    for (;;) {
      const byte = bytes[position];
      position += 1;
      value += (byte & 0x7f) * multiplier;
      if ((byte & 0x80) === 0) break;
      multiplier *= 128;
    }
    offset += value;
    values[index] = offset;
  }
  return values;
}

/** 键下标。`width` 为 2 时按小端 uint16 读。 */
export function decodeIndices(bytes: Uint8Array, count: number, width: number): Uint16Array {
  const values = new Uint16Array(count);
  if (width === 2) {
    for (let index = 0; index < count; index += 1) {
      values[index] = bytes[index * 2] | (bytes[index * 2 + 1] << 8);
    }
  } else {
    for (let index = 0; index < count; index += 1) values[index] = bytes[index];
  }
  return values;
}

/** 解码整个载荷。不可用或空流返回 `null`（界面据此说"没有可放的记录"）。 */
export function decodePressStream(payload: PressStreamResponse | null | undefined): PressStreamData | null {
  if (!payload || !payload.available || !payload.count) return null;
  const times = decodeVarints(decodeBase64(payload.times), payload.count);
  const indices = decodeIndices(decodeBase64(payload.indices), payload.count, payload.index_width);
  const days = (payload.days || []).map((day) => ({ date: day.date, atMs: Number(day.at_ms) || 0 }));
  const spanMs = days.length ? days[days.length - 1].atMs + 86_400_000 : 0;
  const data: PressStreamData = {
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
    p95: 0,
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
export function terminalP95(data: PressStreamData): number {
  const counts = new Uint32Array(data.keys.length);
  for (let index = 0; index < data.count; index += 1) counts[data.indices[index]] += 1;
  return p95OfCounts(counts);
}

/** 某一时刻是第几天（0 起）。没有 `days` 时返回 0。 */
export function dayIndexAt(data: PressStreamData, offsetMs: number): number {
  const days = data.days;
  if (!days.length) return 0;
  let low = 0;
  let high = days.length - 1;
  let found = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (days[middle].atMs <= offsetMs) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/**
 * 游标：按数据时间前进，逐条累加。
 *
 * 只进不退是一个刻意的约束（回放没有"倒带"的需求，倒退就 `seek`）；`seek` 会重建
 * 计数，代价是 O(n)，一天最多用几次（拖进度条），不在每帧路径上。
 */
export class PressCursor {
  readonly data: PressStreamData;
  readonly counts: Uint32Array;
  /**
   * 最近放出的按键下标（环形缓冲，`recentHead` 指向下一个写入位——所以**最新的那颗在
   * `recentHead - 1`**）。3D 场景按它挑"这一拍该让哪颗键帽下沉"，见 `Keyboard3D` 的
   * `startStreamPresses`。
   *
   * 为什么不直接在 `advanceTo` 里回调：一次 `advanceTo` 在 4 秒/天的速率下会放出上万次
   * 按下，逐条回调等于每帧上万次动画调度。留一个 128 的环，让渲染侧自己决定要不要、
   * 要几颗——抽样是**观感**问题，不该混进游标的数据逻辑里。
   */
  readonly recent = new Uint16Array(128);
  /** 环里已经写进去多少条（封顶到 `recent.length`）。 */
  recentCount = 0;
  recentHead = 0;
  /** 当前数据时间（毫秒偏移）。 */
  offset = 0;
  /** 已经放出的按下次数。 */
  total = 0;
  private index = 0;

  constructor(data: PressStreamData) {
    this.data = data;
    this.counts = new Uint32Array(data.keys.length);
  }

  /** 前进到 `offsetMs`，返回这一帧新加的按下次数。 */
  advanceTo(offsetMs: number): number {
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
  seek(offsetMs: number): void {
    this.counts.fill(0);
    this.index = 0;
    this.total = 0;
    this.offset = 0;
    this.advanceTo(Math.max(0, offsetMs));
    // 跳过去的那一大段不算"正在打的手指"：清空环，让按压动画从跳转之后的新按键重新起。
    // 清在 `advanceTo` 之后——否则补放的那几千条会把环塞满，下一拍动的是跳转前的键。
    this.recentCount = 0;
    this.recentHead = 0;
  }

  /** 第一条按下的偏移；用来跳过开头的空档。 */
  get firstOffset(): number {
    return this.data.count ? this.data.times[0] : 0;
  }

  /**
   * 下一颗还没放出来的按键（偏移）；已经放完给 `null`。
   *
   * 时间流逝用它判断"现在是空档还是真的到头了"：空档要跳过，到头了要停在结尾。
   */
  get nextTime(): number | null {
    return this.index < this.data.count ? this.data.times[this.index] : null;
  }
}
