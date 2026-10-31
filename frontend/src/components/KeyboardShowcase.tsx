// 键盘「时间流逝」全屏展示（复刻参考视频：按真实按键顺序累加 + 大字日期/总数）。
//
// 数据面见 `core/press-stream.ts` 与 `services/press_stream.py`；这里只负责三件事：
//   1. 取一次逐次按键流（默认从库里最早的原始月份到今天）；
//   2. 把播放状态（速率/暂停/进度）喂给 `Keyboard3D` 的 stream 模式；
//   3. 渲染左上角那三行大字与底部控制条 —— 3D 那边每 66ms 回一次读数。
//
// **three 仍然只在真正要看 3D 时才加载**：这里对 `Keyboard3D` 用动态 import，和
// `views/keyboard.tsx` 同一条规矩，否则展示层会把 three 拖进主 chunk。
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { get } from '../core/api.ts';
import { decodePressStream } from '../core/press-stream.ts';
import { useSlice } from '../core/useStore.ts';
import { Segmented } from './controls.tsx';
import { formatCount } from '../domain/format.ts';
import type { PressStreamData } from '../core/press-stream.ts';
import type { StreamTick } from './Keyboard3D.tsx';
import type { PressStreamResponse } from '../types/api.d.ts';

const Keyboard3D = lazy(() =>
  import('./Keyboard3D.tsx').then((module) => ({ default: module.Keyboard3D })),
);

/** 数据毫秒 / 真实秒。中速 4 秒一天，与参考视频接近。 */
const RATES = { slow: 10_800_000, normal: 21_600_000, fast: 57_600_000 } as const;
type Rhythm = keyof typeof RATES;
const RHYTHMS = [
  { id: 'slow', name: '慢' },
  { id: 'normal', name: '中' },
  { id: 'fast', name: '快' },
];

type Status = 'loading' | 'ready' | 'empty' | 'error';

function dateLabel(iso: string): string {
  // 视频里是 `2026-05-05` 这种写法：时间流逝看的是"哪一天"，不是本地化日期。
  return iso || '';
}

export function KeyboardShowcase({ onClose }: { onClose: () => void }) {
  const prefs = useSlice('prefs');
  // 右上角署名（`ui.showcase_id`）。**默认没有**：没填就整行不渲染，不留空占位。
  const identity = (prefs.showcaseId || '').trim();
  const [status, setStatus] = useState<Status>('loading');
  const [data, setData] = useState<PressStreamData | null>(null);
  const [note, setNote] = useState('');
  const [playing, setPlaying] = useState(true);
  const [rhythm, setRhythm] = useState<Rhythm>('normal');
  const [seek, setSeek] = useState<number | null>(null);
  const [tick, setTick] = useState<StreamTick | null>(null);

  /** 放到结尾时把控制条切回"重播"（稳定引用：它进 `stage` 的 memo 依赖）。 */
  const endAtTail = useCallback(() => setPlaying(false), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const payload = (await get('/keyboard/press-stream')) as PressStreamResponse;
        if (cancelled) return;
        if (!payload?.available) {
          setNote('设置里没有开启「保存原始按键事件」，拿不到逐次记录');
          setStatus('empty');
          return;
        }
        const decoded = decodePressStream(payload);
        if (!decoded) {
          setNote('这段时间还没有可放的按键记录');
          setStatus('empty');
          return;
        }
        setData(decoded);
        setStatus('ready');
      } catch {
        if (!cancelled) {
          setNote('按键流加载失败');
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Esc 退出 + 锁页面滚动。展示层是全屏的，底下的仪表盘不该跟着滚。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  // 交给场景的播放状态。**必须 memo**：每次渲染都新建对象会让场景每 66ms 重置帧基准。
  const source = useMemo(
    () => (data ? { data, rate: RATES[rhythm], playing, seek } : null),
    [data, rhythm, playing, seek],
  );

  // 读数每 66ms 回一次，但**场景元素不该跟着重建**：它带来的是 three 侧一整棵子树的 diff，
  // 而 `source` 没变时那棵树一个字节都不用改。真正的位移/数字刷新全在场景内部的 rAF 里。
  const stage = useMemo(
    () =>
      source ? (
        <Keyboard3D
          heatmap={null}
          metric="press_count"
          mode="heat"
          stream={source}
          onStreamTick={setTick}
          onStreamEnd={endAtTail}
        />
      ) : null,
    [source, endAtTail],
  );

  const span = data?.spanMs || 1;
  const offset = Math.min(span, Math.max(0, tick?.offsetMs ?? 0));
  const progress = offset / span;
  const atEnd = offset >= span - 1;

  const toggle = () => {
    if (!data) return;
    if (!playing && atEnd) {
      // 放完了再点"播放"应当从头再来，而不是停在结尾一动不动。
      setTick(null);
      setSeek(0);
      setPlaying(true);
      return;
    }
    setPlaying((value) => !value);
  };

  const seekTo = (ratio: number) => {
    if (!data) return;
    setSeek(Math.max(0, Math.min(1, ratio)) * data.spanMs);
    setPlaying(true);
  };

  const day = (tick?.dayIndex ?? 0) + 1;
  const date = tick?.date || data?.from || '';

  return createPortal(
    <div className="showcase" role="dialog" aria-modal="true" aria-label="键盘时间流逝">
      <div className="showcase__top">
        <header className="showcase__hud">
          <div className="showcase__date">{dateLabel(date)}</div>
          <div className="showcase__day">第 {day} 天</div>
          <div className="showcase__total">{formatCount(tick?.total ?? 0)}</div>
        </header>
        <aside className="showcase__aside">
          <div className="showcase__caption">个人日常键盘使用频次数据可视化</div>
          {identity ? <div className="showcase__id">{identity}</div> : null}
        </aside>
      </div>

      <div className="showcase__stage">
        {status === 'ready' && stage ? <Suspense fallback={null}>{stage}</Suspense> : null}
        {status !== 'ready' ? (
          <div className="showcase__veil">
            <span>{status === 'loading' ? '正在读取按键记录…' : note}</span>
            {status === 'loading' ? null : (
              <button type="button" className="showcase__button" onClick={onClose}>
                关闭
              </button>
            )}
          </div>
        ) : null}
      </div>

      {status === 'ready' && data ? (
        <footer className="showcase__bar">
          <button type="button" className="showcase__button" onClick={toggle}>
            {playing ? '暂停' : atEnd ? '重播' : '继续'}
          </button>
          <Segmented
            items={RHYTHMS}
            active={rhythm}
            onPick={(id) => setRhythm(id as Rhythm)}
            small
            label="播放节奏"
          />
          <button
            type="button"
            className="showcase__track"
            aria-label="进度，点击跳到任意时刻"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              seekTo((event.clientX - rect.left) / Math.max(1, rect.width));
            }}
          >
            <i style={{ width: `${(progress * 100).toFixed(2)}%` }} />
          </button>
          <span className="showcase__range">
            {data.from} → {data.to}
          </span>
          {data.truncated ? <span className="showcase__hint">只放了前 200 万次</span> : null}
          <button type="button" className="showcase__button" onClick={onClose}>
            退出
          </button>
        </footer>
      ) : null}
    </div>,
    document.body,
  );
}
