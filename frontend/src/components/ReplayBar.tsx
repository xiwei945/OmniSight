import { useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import {
  MAX_RATE,
  MIN_RATE,
  RATE_STEP,
  formatRate,
  getReplay,
  setRate,
  stop,
  subscribe,
  toggle,
} from '../core/replay.ts';

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
export function ReplayBar() {
  const state = useSyncExternalStore(subscribe, getReplay);
  const busy = state.status === 'loading';
  const active = state.status === 'playing' || state.status === 'paused';
  const label = busy
    ? '加载中…'
    : state.status === 'playing'
      ? '暂停回放'
      : state.status === 'paused'
        ? '继续回放'
        : '播放今天';
  const percent = state.total ? Math.round((state.done / state.total) * 100) : 0;
  /** 拇指位置 0..1：CSS 用它切轨道那一段已过的颜色（见 key-cap.css）。 */
  const position = (state.rate - MIN_RATE) / (MAX_RATE - MIN_RATE);

  return (
    <div className="keyboard-replay">
      <button type="button" onClick={toggle} disabled={busy}>
        {label}
      </button>
      {active ? (
        <button type="button" onClick={stop}>
          停止
        </button>
      ) : null}
      {state.total > 0 ? (
        <>
          <span
            className="keyboard-replay__progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={state.total}
            aria-valuenow={state.done}
            aria-label="回放进度"
          >
            <i style={{ width: `${percent}%` }} />
          </span>
          <span className="keyboard-replay__count">
            {state.done}/{state.total}
          </span>
        </>
      ) : null}
      {state.status === 'empty' ? <span>今天没有可回放的顺序记录</span> : null}
      {state.status === 'error' ? <span>回放加载失败</span> : null}
      {/* 放在最后：它是这一行唯一靠右的东西（CSS 里 `margin-left: auto`），
          状态文案要是排在它后面，就会被推到它右边去。 */}
      <span className="keyboard-replay__rate">
        <label htmlFor="replay-rate">倍速</label>
        <input
          id="replay-rate"
          type="range"
          min={MIN_RATE}
          max={MAX_RATE}
          step={RATE_STEP}
          value={state.rate}
          onChange={(event) => setRate(Number(event.target.value))}
          style={{ '--rate': position } as CSSProperties}
        />
        {/* 读数兼复位：滑条上一个档位一个档位地退回去很烦，点一下直接回到 1×。 */}
        <button
          type="button"
          className="keyboard-replay__rate-value"
          onClick={() => setRate(1)}
          title="回到 1 倍速"
          aria-label={`当前 ${formatRate(state.rate)}，点一下回到 1 倍速`}
        >
          {formatRate(state.rate)}
        </button>
      </span>
    </div>
  );
}
