// 开屏（一次会话只出现一次）。
//
// 它回答一个很具体的问题：这个程序是干什么的，以及它好看。所以三件事——
// 一把猫耳键盘（展示模式，不读数）、一句标题、一个"跳过"。
//
// 为什么不做成路由页：它必须在仪表盘**数据到位之前**就出现，否则用户会先看到
// 一片骨架屏再被开屏盖住。因此它是一个挂在 body 上的浮层，自己起一个 React root，
// 用完把自己连同 root 一起卸载。
//
// **收场时机由动画决定，不是一个猜出来的定时器**：3D 组件演完运镜与水波会回调
// `onIntroEnd`，浮层收到才淡出。定时器只作兜底（模型加载失败、帧率为 0 的极端情况），
// 否则"动画没演完就切页"和"演完了还干等两秒"两种情况都会出现。
//
// 3D 是懒加载的：开屏只在有 WebGL 且用户没要求减少动态时加载 three；否则退化成
// 纯文字 + 渐变的静态开屏——一条 1.4 MB 的 chunk 不该是"看一眼标题"的代价。
import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { webglAvailable } from '../core/webgl.ts';
import { prefersReducedMotion } from '../core/theme.ts';

/** 一次会话只放一次；关掉标签页再开才会再看到。 */
const SEEN_KEY = 'omnisight.opening';
/** 没有 3D 时（无 WebGL / 减少动态）：静态版看 1.4 秒足够。 */
const STATIC_MS = 1400;
/** 兜底：3D 正常时由 onIntroEnd 收场；这个只在模型或回调出问题时防止浮层卡死。 */
const SAFETY_MS = 12000;
/** 淡出时长，与 opening.css 的 .opening--leaving 对齐。 */
const LEAVE_MS = 420;

const Keyboard3D = lazy(() =>
  import('./Keyboard3D.tsx').then((module) => ({ default: module.Keyboard3D })),
);

function Opening({
  leaving,
  withScene,
  onIntroEnd,
}: {
  leaving: boolean;
  withScene: boolean;
  onIntroEnd?: (() => void) | null;
}) {
  return (
    <div className={`opening${leaving ? ' opening--leaving' : ''}`} role="presentation">
      <div className="opening__stage">
        {withScene ? (
          <Suspense fallback={null}>
            {/* 数据传 null：开屏不读数，只展示键盘本身（全冷档 = 奶油本色）。 */}
            <Keyboard3D
              heatmap={null}
              metric="press_count"
              mode="showcase"
              intro
              onIntroEnd={onIntroEnd}
            />
          </Suspense>
        ) : (
          <div className="opening__block" aria-hidden="true" />
        )}
      </div>
      <div className="opening__copy">
        <p className="opening__eyebrow">本地 · 不联网 · 不记录内容</p>
        <h1 className="opening__title">OmniSight</h1>
        <p className="opening__line">今天，你的键盘记住了什么</p>
      </div>
      <div className="opening__hint">点击任意处继续</div>
    </div>
  );
}

/**
 * 首次进入时挂上开屏，返回一个卸载函数（测试与热更新用；正常路径靠动画回调自清）。
 */
export function maybeShowOpening(): () => void {
  let seen = false;
  try {
    seen = sessionStorage.getItem(SEEN_KEY) === '1';
    sessionStorage.setItem(SEEN_KEY, '1');
  } catch {
    // 隐私模式：读不到就当没看过——开屏本来也不是功能。
  }
  if (seen || document.querySelector('.opening')) return () => {};

  // 键盘页自己有 3D；其它页也放，因为开屏是"这个程序的样子"。
  const withScene = webglAvailable() && !prefersReducedMotion();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);

  let done = false;
  const teardown = () => {
    if (done) return;
    done = true;
    root.unmount();
    host.remove();
  };

  let safety = 0;
  const leave = () => {
    if (done) return;
    window.clearTimeout(safety);
    root.render(
      <StrictMode>
        <Opening leaving withScene={withScene} />
      </StrictMode>,
    );
    window.setTimeout(teardown, LEAVE_MS);
  };

  root.render(
    <StrictMode>
      <Opening
        leaving={false}
        withScene={withScene}
        // 水波最后一片回到原位后再停 0.32s 才淡出：让"落定"这一下被看见，
        // 而不是涟漪刚到边就被切走。
        onIntroEnd={withScene ? () => window.setTimeout(leave, 320) : null}
      />
    </StrictMode>,
  );

  // 兜底：3D 演完会自己调 leave()，这里只在它没发生时接管。
  safety = window.setTimeout(leave, withScene ? SAFETY_MS : STATIC_MS);

  const skip = () => leave();
  host.addEventListener('pointerdown', skip, { once: true });
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') skip();
  };
  window.addEventListener('keydown', onKey, { once: true });
  host.addEventListener('click', skip, { once: true });

  // 键盘页面自己也会监听 Escape；开屏期间先别让它把详情面板关了。
  window.setTimeout(
    () => window.removeEventListener('keydown', onKey),
    (withScene ? SAFETY_MS : STATIC_MS) + LEAVE_MS,
  );

  return teardown;
}

/** 测试/调试用：手动清掉"看过"的标记。 */
export function resetOpeningForTests(): void {
  try {
    sessionStorage.removeItem(SEEN_KEY);
  } catch {
    // 同上。
  }
}
