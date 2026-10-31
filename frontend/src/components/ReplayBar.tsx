import { useSyncExternalStore } from 'react';
import { getReplay, subscribe, toggle } from '../core/replay.ts';

/**
 * 回放控件（14 文档）。**2D 与 3D 共用同一个**——它在视图层渲染一次，两条渲染路径都
 * 只通过总线订阅 `key:press`，因此这里不需要知道当前是哪种视图。
 */
export function ReplayBar() {
  const state = useSyncExternalStore(subscribe, getReplay);
  const busy = state.status === 'loading';
  const label = busy
    ? '加载中…'
    : state.status === 'playing'
      ? '暂停回放'
      : state.status === 'paused'
        ? '继续回放'
        : '播放今天';
  const percent = state.total ? Math.round((state.done / state.total) * 100) : 0;

  return (
    <div className="keyboard-replay">
      <button type="button" onClick={toggle} disabled={busy}>
        {label}
      </button>
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
    </div>
  );
}
