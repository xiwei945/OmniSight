// 按键顺序回放（14 文档「实时按压动画」条目的离线版）。
//
// **为什么是一个独立模块而不是两个视图各写一份**：2D 键帽与 3D 键帽都要按同一段顺序
// 动。它们只需要订阅总线上的 `key:press`——而"谁在放、放到哪了、暂停没有"是**一份**
// 状态，放在这里，视图用 `subscribe` 订阅它渲染按钮，恢复时也读它。
//
// 节奏按**真实时间戳**放，不是固定间隔：一天的按键挤在几个爆发段里，固定间隔会把
// 爆发摊平成均匀的机枪声，看不出"在哪里一口气打了 200 字"。整体压缩到目标时长
// （`TARGET_MS`），于是哪怕几万次按键也在半分钟里放完；事件在虚拟时间轴上触发，
// 一帧内到期的全部发出——爆发段因此表现为"几个键同时亮"，而不是排队。
//
// 虚拟时钟与 rAF 绑定：标签页切到后台时 rAF 停摆，回放自然挂起，回来接着放，
// 不需要额外处理"后台时要不要走时钟"。
import { get as apiGet } from './api.ts';
import { emit } from './bus.ts';
import { tally } from './replay-counts.ts';
import type { ReplayTally } from './replay-counts.ts';

export type ReplayStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'empty' | 'error';

export interface ReplayState {
  status: ReplayStatus;
  /** 这一段一共有多少次按下。 */
  total: number;
  /** 已经放出多少次。 */
  done: number;
  /** 当前倍速（0.5–4）。改它不影响已经放出去的部分，下一帧就按新速率走。 */
  rate: number;
}

export interface ReplayEvent {
  key_id: string;
  /** 相对当天 0 点的毫秒偏移。 */
  t: number;
  /** 那一次按住多久（毫秒）。老数据可能缺，缺了按 0 计。 */
  d?: number;
}

/**
 * 这一份回放的账。`run` 每次 `start()` 自增，宿主据此判断"这是新的一次"还是
 * "暂停后继续"——**重播必须能把计数清零**，否则第二次放出来的数字是叠加的。
 */
export interface ReplayMeta {
  run: number;
  tally: ReplayTally;
}

/** 整体回放时长目标。几万次按键也在这个量级放完。 */
const TARGET_MS = 30_000;
/** 上限：极长或极稀疏的一天也别放成十分钟。超出的间隔按这个封顶。 */
const MAX_GAP_MS = 900;
/**
 * 下限：相邻两颗键在屏幕上的最短间隔。
 *
 * **这个数就是"顺序看得见"本身**：原来是 6ms，远小于一帧（16.7ms），于是一帧内到期的
 * 按键全被同一次 rAF 发出去——画面上是"整块键盘同时闪"，而不是 d→w→a→s。40ms 约 2.4 帧，
 * 一颗接一颗才读得出来；再快就只剩一糊。
 */
const MIN_GAP_MS = 40;
/** 单帧最多推进多少毫秒。切后台回来时用它把"错过的几个小时"夹掉。 */
const MAX_FRAME_MS = 100;

/**
 * 倍速范围与档距。
 *
 * **为什么需要它**：`MIN_GAP_MS` 是每颗键的下限，于是这一天的总时长至少是
 * `(N-1) × 40ms`——一万次按下就是 6.7 分钟，`TARGET_MS` 那个"压到 30 秒"的目标根本
 * 轮不到它说话（下限赢）。所以"太慢"不是压缩系数算错了，是这条路本身有个地板；
 * 想更快只能显式地跨过地板，也就是倍速。
 */
export const MIN_RATE = 0.5;
export const MAX_RATE = 4;
/** 档距。滑条按它吸附，`clampRate` 也按它取整，两者才不会给出对不上的值。 */
export const RATE_STEP = 0.25;

const RATE_KEY = 'omnisight.replayRate';

/** 夹到 `[MIN_RATE, MAX_RATE]` 并对齐档距。非法值（NaN、localStorage 里被人写坏）回 1。 */
export function clampRate(value: number): number {
  if (!Number.isFinite(value)) return 1;
  const snapped = Math.round(value / RATE_STEP) * RATE_STEP;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, Number(snapped.toFixed(2))));
}

/** `1×` / `0.75×`：整数不带小数点，其余去掉末尾的 0。 */
export function formatRate(rate: number): string {
  return `${rate.toFixed(2).replace(/\.?0+$/, '')}×`;
}

/** 倍速跟着这台浏览器走（像主题那样），不进配置：它是**播放方式**，不是一条应用设置。 */
function readRate(): number {
  try {
    if (typeof localStorage === 'undefined') return 1;
    const raw = localStorage.getItem(RATE_KEY);
    return raw == null ? 1 : clampRate(Number(raw));
  } catch {
    // 隐私模式，或（node 下的单测）没有 localStorage：用默认档。
    return 1;
  }
}

function writeRate(rate: number): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(RATE_KEY, String(rate));
  } catch {
    // 同上：记不住就记不住，本次会话里仍然是这个速度。
  }
}

/** 倍速不随 status 重置，所以它不放在 state 里被各处覆写，而是由 `setState` 统一带上。 */
let rate = readRate();

let state: ReplayState = { status: 'idle', total: 0, done: 0, rate };
const listeners = new Set<(value: ReplayState) => void>();

let events: ReplayEvent[] = [];
/** 每条事件的**虚拟触发时刻**（毫秒），在装载时一次算好。 */
let schedule: number[] = [];
let cursor = 0;
/** 装载时算出的整段缩放系数（`TARGET_MS` 那一档）。与用户可调的 `rate` 无关。 */
let spanScale = 1;
let raf = 0;
/** 这一份回放的账（每键累计 + 色阶分母需要的终值）。`run` 每次开播自增。 */
let meta: ReplayMeta | null = null;
let runSeq = 0;
/**
 * 虚拟时钟。**累加**而不是"起点 + 墙钟差"：后者的写法在标签页切后台时，rAF 停摆
 * 几分钟回来，`now - wallBase` 一次跳掉几分钟，一帧里把几千颗键全发出去——画面成了
 * 一次闪光，顺序也就没了。累加式每帧最多认 100ms。
 */
let elapsed = 0;
let lastFrameAt = 0;
/** 上一次把进度写进 state 的时刻。进度条不需要 60fps，节流到 5Hz。 */
let lastReport = 0;

function notify(): void {
  for (const listener of [...listeners]) listener(state);
}

/** 调用方只给"这一段变了什么"，倍速由这里统一补上——否则每次改 status 都会把它抹掉。 */
function setState(next: Omit<ReplayState, 'rate'>): void {
  state = { ...next, rate };
  notify();
}

export function getReplay(): ReplayState {
  return state;
}

/**
 * 改倍速。**播放中改立刻生效**：`frame()` 每帧读的是当前值，不重建时间轴，
 * 所以已经放出去的部分不会跳、不会重算，只是从现在开始走得快/慢一点。
 */
export function setRate(value: number): number {
  const next = clampRate(value);
  if (next === rate) return rate;
  rate = next;
  state = { ...state, rate };
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
export function getReplayMeta(): ReplayMeta | null {
  return meta;
}

/** @returns 注销函数 */
export function subscribe(listener: (value: ReplayState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function today(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

/**
 * 把带时间戳的事件压成一条**虚拟时间轴**：先算整段的缩放系数（总时长压到 `TARGET_MS`），
 * 再把每个间隔夹到 `[MIN_GAP_MS, MAX_GAP_MS]` 后累加。夹完再累加，而不是先累加再夹——
 * 后者会让封顶的那一段之后所有事件整体前移，与真实顺序错位。
 */
function buildSchedule(list: ReplayEvent[]): void {
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

function frame(): void {
  if (state.status !== 'playing') return;
  const now = performance.now();
  // 倍速乘在**虚拟时钟**上，而不是重建时间轴：时间轴是装载时算好的一份相对顺序，
  // 乘在这里等于把整条轴拉快/拉慢，光标位置与已发出的计数都不用动。
  // 代价是它同时跨过了 `MIN_GAP_MS`——4× 时每帧会吐出 1.6 颗键，一帧里同亮的键
  // 看起来就是同时按下的。那正是"我要更快"的含义：用户用顺序可读性换时间。
  elapsed += Math.min(MAX_FRAME_MS, Math.max(0, now - lastFrameAt)) * rate;
  lastFrameAt = now;
  while (cursor < events.length && schedule[cursor] <= elapsed) {
    const event = events[cursor];
    // 两条通道：`key:press` 是"这一下发生了"（2D 与 3D 都只靠它做按压动画），
    // `key:press:detail` 多带一个按住时长——只有要**累加读数**的 3D 场景需要它。
    // 合成一条会逼着 2D 视图也去认识 `d`，而它根本不用。
    emit('key:press', [event.key_id]);
    emit('key:press:detail', [{ key_id: event.key_id, d: event.d ?? 0 }]);
    cursor += 1;
  }
  if (cursor >= events.length) {
    setState({ status: 'idle', total: events.length, done: events.length });
    return;
  }
  if (now - lastReport > 200) {
    lastReport = now;
    setState({ ...state, done: cursor });
  }
  raf = window.requestAnimationFrame(frame);
}

function cancelFrame(): void {
  if (raf) {
    window.cancelAnimationFrame(raf);
    raf = 0;
  }
}

export async function start(): Promise<void> {
  cancelFrame();
  if (state.status === 'loading') return;
  setState({ status: 'loading', total: 0, done: 0 });
  try {
    const payload = (await apiGet('/keyboard/replay', { date: today() })) as {
      available?: boolean;
      events?: ReplayEvent[];
    };
    if (!payload.available || !payload.events?.length) {
      events = [];
      schedule = [];
      meta = null;
      setState({ status: 'empty', total: 0, done: 0 });
      return;
    }
    events = payload.events;
    buildSchedule(events);
    // 一次遍历把这一天的账算好：每键累计（次数/总时长/最长）+ 色阶分母要用的终值。
    // 放在装载时算，而不是边放边算——边放边算拿不到"终值"，颜色会在中途被重新归一。
    runSeq += 1;
    meta = { run: runSeq, tally: tally(events) };
    cursor = 0;
    elapsed = 0;
    lastFrameAt = performance.now();
    lastReport = 0;
    setState({ status: 'playing', total: events.length, done: 0 });
    raf = window.requestAnimationFrame(frame);
  } catch {
    meta = null;
    setState({ status: 'error', total: 0, done: 0 });
  }
}

export function pause(): void {
  if (state.status !== 'playing') return;
  cancelFrame();
  setState({ ...state, status: 'paused' });
}

export function resume(): void {
  if (state.status !== 'paused') return;
  // 基准拉到"现在"：暂停期间的时间不计入虚拟时钟，继续时不会一下子补播一大段。
  lastFrameAt = performance.now();
  setState({ ...state, status: 'playing' });
  raf = window.requestAnimationFrame(frame);
}

export function toggle(): void {
  if (state.status === 'playing') pause();
  else if (state.status === 'paused') resume();
  else void start();
}

/** 离开键盘视图时停掉，避免 rAF 在后台空转、也避免事件打到已卸载的组件上。 */
export function stop(): void {
  cancelFrame();
  events = [];
  schedule = [];
  meta = null;
  cursor = 0;
  elapsed = 0;
  setState({ status: 'idle', total: 0, done: 0 });
}
