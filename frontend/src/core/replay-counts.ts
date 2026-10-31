// 「播放今天」的计数：把一天的有序按下累加成每键的四个指标。
//
// 为什么要有这个模块：`日常` 观感原来是**静态读数**（今天的终值），回放只让键帽动一下。
// 2026-10-31 用户要求"从 0 涨起、放完停在今天的读数"——那就需要在回放过程中维护一份
// 累计量，并且四个 metric（次数/总时长/均时长/最长）都要能涨。
//
// 数据是够的：`replay_day` 每条事件都带 `d`（那一次按住多久，见
// `storage/repositories/keys.py`），所以不是"只有次数能涨"。
//
// 纯函数，不碰 DOM / three，`node --test --experimental-strip-types` 直接跑。
import { p95OfCounts } from './counts.ts';

/** 一个键在一段回放里的累计量。四个 metric 都由它派生。 */
export interface KeyTally {
  count: number;
  /** 累计按住时长（毫秒）。 */
  sumMs: number;
  /** 最长的一次按住（毫秒）。 */
  maxMs: number;
}

export interface ReplayTally {
  totals: Map<string, KeyTally>;
  events: number;
}

export interface ReplayEventLike {
  key_id: string;
  /** 按住时长；老数据缺这一项时按 0 计（不影响次数）。 */
  d?: number;
}

/** 一次遍历把整段事件累加成每键的账。 */
export function tally(events: readonly ReplayEventLike[]): ReplayTally {
  const totals = new Map<string, KeyTally>();
  for (const event of events) {
    let acc = totals.get(event.key_id);
    if (!acc) {
      acc = { count: 0, sumMs: 0, maxMs: 0 };
      totals.set(event.key_id, acc);
    }
    acc.count += 1;
    const held = Number.isFinite(event.d) ? Math.max(0, event.d as number) : 0;
    acc.sumMs += held;
    if (held > acc.maxMs) acc.maxMs = held;
  }
  return { totals, events: events.length };
}

/**
 * 累计量 → 当前 metric 的读数。
 *
 * metric id 与 `domain/metrics.ts` 的 `METRICS` 一一对应；未知 id 按次数处理——
 * 宁可显示一个能读的数字，也不要让键面空着。
 */
export function valueOfMetric(metric: string, acc: KeyTally): number {
  switch (metric) {
    case 'duration_total_ms':
      return acc.sumMs;
    case 'duration_avg_ms':
      return acc.count > 0 ? acc.sumMs / acc.count : 0;
    case 'duration_max_ms':
      return acc.maxMs;
    default:
      return acc.count;
  }
}

/**
 * 色阶分母：整段回放**终值**在该 metric 下的 p95。
 *
 * 用终值而不是"当前这一帧的最大值"：后者会让颜色每帧重新归一，一颗键刚变深又被
 * 后来的键压回去，看的人只会觉得"颜色在乱跳"。用终值，颜色只朝一个方向走。
 */
export function p95OfMetric(metric: string, tally: ReplayTally): number {
  const values: number[] = [];
  for (const acc of tally.totals.values()) values.push(valueOfMetric(metric, acc));
  return p95OfCounts(values);
}
