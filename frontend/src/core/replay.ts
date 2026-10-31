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

export type ReplayStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'empty' | 'error';

export interface ReplayState {
  status: ReplayStatus;
  /** 这一段一共有多少次按下。 */
  total: number;
  /** 已经放出多少次。 */
  done: number;
}

export interface ReplayEvent {
  key_id: string;
  /** 相对当天 0 点的毫秒偏移。 */
  t: number;
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

let state: ReplayState = { status: 'idle', total: 0, done: 0 };
const listeners = new Set<(value: ReplayState) => void>();

let events: ReplayEvent[] = [];
/** 每条事件的**虚拟触发时刻**（毫秒），在装载时一次算好。 */
let schedule: number[] = [];
let cursor = 0;
let speed = 1;
let raf = 0;
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

function setState(next: ReplayState): void {
  state = next;
  notify();
}

export function getReplay(): ReplayState {
  return state;
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
  speed = span > TARGET_MS ? span / TARGET_MS : 1;
  let virtual = 0;
  schedule.push(0);
  for (let index = 1; index < list.length; index += 1) {
    const gap = Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, (list[index].t - list[index - 1].t) / speed));
    virtual += gap;
    schedule.push(virtual);
  }
}

function frame(): void {
  if (state.status !== 'playing') return;
  const now = performance.now();
  elapsed += Math.min(MAX_FRAME_MS, Math.max(0, now - lastFrameAt));
  lastFrameAt = now;
  while (cursor < events.length && schedule[cursor] <= elapsed) {
    emit('key:press', [events[cursor].key_id]);
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
      setState({ status: 'empty', total: 0, done: 0 });
      return;
    }
    events = payload.events;
    buildSchedule(events);
    cursor = 0;
    elapsed = 0;
    lastFrameAt = performance.now();
    lastReport = 0;
    setState({ status: 'playing', total: events.length, done: 0 });
    raf = window.requestAnimationFrame(frame);
  } catch {
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
  cursor = 0;
  elapsed = 0;
  setState({ status: 'idle', total: 0, done: 0 });
}
