// 猫耳键盘 3D（奶油拿铁版）。
//
// 一把 104 键的猫耳键帽键盘：键帽后缘有两只耳朵、中间下凹，是几何高度场，不是贴图画的。
// 呈现的是**一屏可读数的立体键盘**：固定 3/4 视角，浅色键帽按使用量上色，每个键面印着当前
// 指标的读数。刻意不做旋转/缩放——这是一张要读数的可视化，不是可把玩的模型，视角一转、
// 键面数字就废了。按下时键帽仍然下沉，是这块面板里保留的唯一动效。
//
// 两种模式（18 文档 §7 的「展示 / 日常」分叉）：
//   heat      日常：中性图集（白底深字）+ 逐键染热力色。数据最清楚。
//   showcase  展示：原图集（奶油/巧克力/蓝的本色）+ 热力键发光。最好看。
//
// 键面数字是**屏幕空间的 HTML 叠层**：把每个键帽中心投影到画布坐标，盖一个 span。相机固定，
// 所以这些位置只在容器尺寸变化时重算，不进每一帧。
//
// three 是重依赖：由 `views/keyboard.tsx` 动态 import，只有切到 3D 才加载，2D 用户不付。
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { on as busOn } from '../core/bus.ts';
import { getReplay, getReplayMeta, subscribe as subscribeReplay } from '../core/replay.ts';
import { p95OfMetric, valueOfMetric } from '../core/replay-counts.ts';
import { dayIndexAt, PressCursor } from '../core/press-stream.ts';
import { prefersReducedMotion } from '../core/theme.ts';
import { formatCount } from '../domain/format.ts';
import { formatMetric, heatLevel } from '../domain/metrics.ts';
import {
  COLD_FACE,
  MODEL_URL,
  NEUTRAL_ATLAS_URL,
  heatRamp,
  inkFor,
  modelLevels,
  parseNodeName,
} from '../domain/keyboard-cat.ts';
import type { PressStreamData } from '../core/press-stream.ts';
import type { KeyTally } from '../core/replay-counts.ts';
import type { ReplayState } from '../core/replay.ts';
import type { HeatmapKey, HeatmapResponse } from '../types/api.d.ts';

/** 渲染模式：日常染色 / 展示发光。 */
export type Keyboard3DMode = 'heat' | 'showcase';

/** 按下动画时长。 */
const PRESS_MS = 170;
/** 下沉深度（模型单位 = 米）。键帽本身高 4mm，沉 1.6mm 是明显的 40%。 */
const PRESS_DEPTH = 0.0016;

/**
 * 按压时叠的那层光。**接近白**而不是色阶里的沙色：热力档最暖的几档本身就是沙/橙，
 * 沙上加沙等于没有反馈。「日常」那套彩色键帽上，只有提亮（而不是换色）才读得出来。
 */
const PRESS_GLOW = '#ffe9c8';

/** 时间流逝：数据时间的推进速率（每 1 秒真实时间推进多少毫秒数据）。 */
export interface KeyboardStreamSource {
  data: PressStreamData;
  /** 数据毫秒 / 真实秒。一天 = 86_400_000；4 秒/天就是 21_600_000。 */
  rate: number;
  playing: boolean;
  /** 拖进度：变化时跳到这里（数据毫秒偏移）。 */
  seek: number | null;
}

/** 时间流逝每 ~66ms 报一次，宿主只拿它渲染大字与日期，不参与 3D。 */
export interface StreamTick {
  offsetMs: number;
  total: number;
  dayIndex: number;
  date: string;
  playing: boolean;
}

/** 时间流逝的刷新节拍：键面数字与颜色不需要 60fps，15Hz 肉眼就是连续的。 */
const STREAM_REFRESH_MS = 66;

/**
 * 空档跳过的门槛（真实毫秒）：下一颗键要等的时间超过它，就把时钟直接推过去。
 *
 * 0.14 秒是"画面明显停了一下"的那个量级——低于它，等与不等看不出区别；高于它，
 * 停着的那段只会被读成卡住。读数本身还有 66ms 的刷新节拍，所以这个值必须比一节拍
 * 大一点点、又不能大到让人等，取 140ms。见 `skipGap`。
 */
const GAP_SKIP_WALL_MS = 140;


/** 固定视角：略高的 3/4 俯视，右侧稍近。界面不提供改它的入口。 */
const CAMERA_DIRECTION = new THREE.Vector3(0, 1, 0.42).normalize();
/** 开屏运镜：从 2.4 倍距离拉到取景距离，缓出 3.6 秒。 */
const INTRO_MS = 1800;
const INTRO_START_SCALE = 2.6;
/** 水波：从键盘中心向四周散开，每米延迟 RIPPLE_DELAY_MS_PER_M，单键起伏 RIPPLE_MS。 */
/**
 * 传播延迟。这个数决定**波峰有多宽**：波峰宽度 ≈ 速度 x RIPPLE_MS，而速度 = 1/延迟。
 * 延迟 2200 时波峰横跨 0.22m（11 个键），相邻键只差 42ms——整块板几乎一起起伏，
 * 眼睛看到的是"整体呼吸"，不是环。5000 时波峰只有 4 个键宽，邻键相差约 95ms，
 * 一两个键明显凸起、旁边还是平的，环才读得出来。
 */
const RIPPLE_DELAY_MS_PER_M = 5000;
const RIPPLE_MS = 420;
/**
 * 起伏高度。**别再调小**：这个视角是近正视（俯角 23°），屏幕上的纵向位移只有实际高度的
 * sin(23°)≈0.39 倍；12mm 只投出 5mm（约 10px），看起来就是"亮了一下"。18mm 才够读。
 */
const RIPPLE_DEPTH = 0.018;
const CAMERA_FOV = 18;

interface KeyEntry {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  /** 原图集（模型自带的贴图），展示模式用。 */
  originalMap: THREE.Texture | null;
  baseY: number;
  pressStart: number | null;
  /** 水波动画的开始时刻（含传播延迟）；null = 没在起伏。 */
  rippleAt: number | null;
  /** 键帽中心（世界坐标），数字叠层按它投影定位。 */
  center: THREE.Vector3;
  /** 键帽半宽（世界单位），用来推字号。 */
  halfWidth: number;
  /** 键帽在屏幕上的宽度（px）与读数下移量，`placeLabels` 每帧复用（不重量字体）。 */
  widthPx: number;
  offsetPx: number;
  label: HTMLDivElement;
  valueNode: HTMLSpanElement;
  level: number;
  /**
   * 上一次写进 `transform` 的屏幕位置。相机每帧都在飘，但**大部分帧的位移不到半像素**
   * ——按半像素去重，静止键位就一次 DOM 写都不发生。见 `placeLabels`。
   */
  lastX: number;
  lastY: number;
  /** 上一次印上键面的次数：没变就跳过格式化（`formatCount` 是这条路径上最贵的一格）。 */
  lastCount: number;
}

interface SceneHandle {
  setData: (heatmap: HeatmapResponse | null | undefined, metric: string) => void;
  setMode: (mode: Keyboard3DMode) => void;
  /** 时间流逝：喂一段逐次按键流；null 关闭。 */
  setStream: (stream: KeyboardStreamSource | null) => void;
  /** 主题换了之后重读一次热力色。 */
  refreshColors: () => void;
  dispose: () => void;
}

interface SceneCallbacks {
  onSelect: (keyId: string) => void;
  onReady: () => void;
  onError: () => void;
  onKeysLoaded: (keyIds: string[]) => void;
  /** 开屏运镜 + 水波全部演完。宿主据此才收掉浮层（不再靠猜时间）。 */
  onIntroEnd: () => void;
  /** 时间流逝的读数（约 15Hz）。 */
  onStreamTick: (tick: StreamTick) => void;
  /** 时间流逝放到结尾。 */
  onStreamEnd: () => void;
}

export interface Keyboard3DProps {
  heatmap: HeatmapResponse | null | undefined;
  metric: string;
  mode?: Keyboard3DMode;
  /** 开屏用：从远处拉近 + 放一轮水波。日常进页不要开。 */
  intro?: boolean;
  /** 时间流逝：逐次按键流 + 播放状态。给了它就进入"计数在上色"的展示模式。 */
  stream?: KeyboardStreamSource | null;
  /** 开屏动画（运镜 + 水波）演完时回调一次。宿主据此收浮层。 */
  onIntroEnd?: (() => void) | null;
  onSelectKey?: ((keyId: string) => void) | null;
  /** 模型加载完回报它实际带的键位，供视图核对当前布局里有没有键位不在模型上。 */
  onKeysLoaded?: ((keyIds: string[]) => void) | null;
  onStreamTick?: ((tick: StreamTick) => void) | null;
  onStreamEnd?: (() => void) | null;
}

/** 落影贴图：中心深、边缘透明的径向渐变，缩放成椭圆后就是一块柔和的贴地影。 */
function softShadowTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(60, 44, 30, 0.5)');
    gradient.addColorStop(0.5, 'rgba(60, 44, 30, 0.24)');
    gradient.addColorStop(1, 'rgba(60, 44, 30, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(canvas);
}

/** 从 CSS 里读热力色，读不到就退回组件内置的那一套。 */
function cssHeatRamp(): string[] {
  const style = getComputedStyle(document.documentElement);
  return heatRamp((name) => style.getPropertyValue(name));
}

/** 时间流逝的色阶（白 → 蓝 → 沙 → 橙 → 红）。理由见 tokens.css 的 `--show-heat-*`。 */
const SHOW_HEAT_FALLBACK = ['#a9c6e6', '#7fa9d6', '#e6c48e', '#e08b4f', '#cf4a3d'];

function cssShowRamp(): string[] {
  const style = getComputedStyle(document.documentElement);
  const steps = SHOW_HEAT_FALLBACK.map(
    (fallback, index) => style.getPropertyValue(`--show-heat-${index + 1}`).trim() || fallback,
  );
  return [COLD_FACE, ...steps];
}

function createKeyboardScene(
  container: HTMLElement,
  callbacks: SceneCallbacks,
  initialMode: Keyboard3DMode,
  intro: boolean,
): SceneHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  // 真实投影。这不是"更真实"的洁癖：键帽和定位板是同一个奶白色，没有投影就融成一片，
  // 上盖的 4mm 台级读不出来，键帽上下动也没有影子跟着走——水波看起来就像没动。
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // **阴影贴图按需重画**：灯和键盘都是静的，只有键帽在起伏/下沉时影子才会变。
  // 交给 three 每帧重画一次 2048² 的投影（还有 104 个投影物）是这台页面里最贵的一笔，
  // 而日常模式下键帽根本不动——那一遍纯属白烧。见 loop 里的 `capsMoved`。
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  const canvas = renderer.domElement;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  canvas.style.cursor = 'pointer';
  container.appendChild(canvas);

  // 数字叠层。**指针事件穿透**，否则会吃掉 canvas 上的点选。相机固定，位置只在
  // 尺寸变化时重算，因此这里不进渲染循环。
  const layer = document.createElement('div');
  layer.className = 'keyboard-3d__labels';
  container.appendChild(layer);

  // 悬停气泡：键面数字收窄到键宽以内，完整数值（含单位）在这里给。
  // 它是 HTML 而不是 3D 文字——远小近大的 3D 字在 25px 的键上依旧是 6px。
  const tip = document.createElement('div');
  tip.className = 'keyboard-3d__tip';
  tip.hidden = true;
  container.appendChild(tip);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.5;
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.01, 200);

  scene.add(new THREE.HemisphereLight(0xfff6ea, 0xc9bda9, 0.55));
  const sun = new THREE.DirectionalLight(0xfff3e2, 2.1);
  sun.position.set(0.4, 1.0, 0.62);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.0006;
  scene.add(sun);
  scene.add(sun.target);
  const fill = new THREE.DirectionalLight(0xe6eeff, 0.5);
  fill.position.set(-0.7, 0.45, -0.5);
  scene.add(fill);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  /** 投影用的临时向量。`placeLabels` 每帧 104 次，不在这里 new。 */
  const scratch = new THREE.Vector3();

  const keys = new Map<string, KeyEntry>();
  const pickTargets: THREE.Mesh[] = [];
  const reduced = prefersReducedMotion();

  let ramp = cssHeatRamp();
  /** 时间流逝专用色阶（冷 → 暖）。见 tokens.css 的 `--show-heat-*`。 */
  let showRamp = cssShowRamp();
  /** 上面那一档色阶预先解析好的 three 颜色与数字墨色（热路径上不再解析字符串）。 */
  let showColors = showRamp.map((color) => new THREE.Color(color));
  let showInk = showRamp.map((color) => inkFor(color));
  let levels = new Map<string, number>();
  let values = new Map<string, HeatmapKey>();
  let metric = 'press_count';
  let mode: Keyboard3DMode = initialMode;
  let neutralMap: THREE.Texture | null = null;
  let disposed = false;
  let ready = false;
  let raf = 0;
  /** 开屏运镜的起始时刻；0 = 还没开始。 */
  let introAt = 0;
  let introDone = !intro;
  /** 水波剩余次数（开屏里放两次：一次开场、一次收尾前的回响）。 */
  let ripplesLeft = intro ? 1 : 0;
  let nextRippleAt = 0;
  /** 最后一片涟漪回到原位的时刻；0 = 还没开始。 */
  let introRippleEnd = 0;
  let introNotified = false;
  const modelSize = new THREE.Vector3();
  const modelCenter = new THREE.Vector3();
  let fitDistance = 0;

  // ── 时间流逝 ───────────────────────────────────────────────────────────
  /** 当前喂进来的逐次按键流；null = 不在展示模式。 */
  let stream: KeyboardStreamSource | null = null;
  let streamCursor: PressCursor | null = null;
  /** 色阶上限：终值的 p95（装在 decodePressStream 里算好）。 */
  let streamP95 = 1;
  /** 上一次已应用的 seek 值（同一个值不重复跳）。 */
  let streamSeekApplied: number | null = null;
  let streamLastFrame = 0;
  let streamLastRefresh = 0;
  let streamEnded = false;
  /** key_id → 按键流里的下标。 */
  let streamIndex = new Map<string, number>();

  // ── 「播放今天」的计数舞台 ──────────────────────────────────────────────
  //
  // 回放时键面数字从 0 涨起来，放完停回今天的读数（`views/keyboard.tsx` 的按钮）。
  // 这里只维护"累计到此刻"的账：`replayAcc` 是每键的 {次数, 总时长, 最长}，`replayP95`
  // 是整段的色阶分母（终值 p95，装载时算好——边放边算会让颜色每帧重新归一）。
  let replayActive = false;
  /** 这一次回放的序号；变了说明是"重播"，账要清零。 */
  let replayRun = -1;
  let replayP95 = 1;
  let replayAcc = new Map<string, KeyTally>();
  /** 这一帧有读数变了的键。只重绘它们，别每次扫 104 个。 */
  let replayDirty = new Set<string>();

  /**
   * 取景：把包围盒的 8 个角投影到 NDC，按实际占屏比例迭代收缩距离。
   *
   * 早先按 `size.z*0.9 + size.y` 估竖直跨度——对这把 445×130×30mm 又宽又扁的键盘不准，
   * 45° 俯视时前缘会掉出画布（空格那一排被切掉）。迭代四次足够收敛，换视角也不必重推公式。
   */
  function fitCamera(): void {
    if (modelSize.lengthSq() === 0) return;
    const corners = [
      [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
      [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1],
    ].map(
      ([x, y, z]) =>
        new THREE.Vector3(
          modelCenter.x + (x * modelSize.x) / 2,
          modelCenter.y + (y * modelSize.y) / 2,
          modelCenter.z + (z * modelSize.z) / 2,
        ),
    );
    const tanV = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV) / 2);
    const tanH = tanV * Math.max(camera.aspect, 0.0001);
    // 初值按宽度给，竖直方向交给下面的迭代修正。
    let distance = ((modelSize.x / 2) * 1.08) / tanH;
    const projected = new THREE.Vector3();
    for (let pass = 0; pass < 4; pass += 1) {
      camera.position.copy(modelCenter).addScaledVector(CAMERA_DIRECTION, distance);
      camera.lookAt(modelCenter);
      camera.updateMatrixWorld();
      let maxX = 0;
      let maxY = 0;
      for (const corner of corners) {
        projected.copy(corner).project(camera);
        maxX = Math.max(maxX, Math.abs(projected.x));
        maxY = Math.max(maxY, Math.abs(projected.y));
      }
      const overflow = Math.max(maxX / 0.92, maxY / 0.92);
      distance *= overflow;
      if (Math.abs(overflow - 1) < 0.005) break;
    }
    fitDistance = distance;
    camera.position.copy(modelCenter).addScaledVector(CAMERA_DIRECTION, fitDistance);
    camera.lookAt(modelCenter);
    camera.updateMatrixWorld();
  }

  function valueOf(keyId: string): number {
    const key = values.get(keyId);
    if (!key) return 0;
    return Number((key as unknown as Record<string, unknown>)[metric]) || 0;
  }

  /**
   * 逐键上色。
   * heat：中性图集 + 热力色当 diffuse，字色按档位翻白。
   * showcase：换回原图集（本色），改由 emissive 发光表达热度。
   *
   * 单独抽出来是因为**回放计数**也要按同一套规则给单颗键上色（见 `paintCount`）：
   * 上色规则只写一份，两处就不会出现"回放看着像热力图、热力图又是另一套"。
   * `needsUpdate` 只在贴图真的换了时才置位——它是给 shader 重编用的信号。
   */
  function applyKeyLook(entry: KeyEntry): void {
    const palette = stream ? showRamp : ramp;
    const color = palette[entry.level] ?? palette[0];
    const map = mode === 'heat' ? neutralMap : entry.originalMap;
    if (entry.material.map !== map) {
      entry.material.map = map;
      entry.material.needsUpdate = true;
    }
    if (mode === 'heat') {
      entry.material.color.set(color);
      entry.material.emissive.set('#000000');
      entry.material.emissiveIntensity = 0;
      entry.label.style.color = inkFor(color);
    } else {
      entry.material.color.set('#ffffff');
      // 发光用**固定的暖光**而不是热力色本身：色阶最热那两档是深咖，让它自发光
      // 等于发一团黑光，越热反而越暗。亮度按档位抬，颜色始终是灯的颜色。
      entry.material.emissive.set('#ffb271');
      entry.material.emissiveIntensity = entry.level === 0 ? 0 : 0.03 + entry.level * 0.085;
      entry.label.style.color = '#fff8ef';
    }
  }

  function applyLook(): void {
    for (const entry of keys.values()) applyKeyLook(entry);
  }

  /**
   * 按压/水波结束后，把发光还原成这一档该有的样子。
   *
   * 「展示」是按档位常亮的暖光，「日常」本来不发光（颜色已经表达了读数）。按压动画会
   * 临时盖掉 emissive，收尾时**必须还原**，否则放完一轮回放，整块键盘会留在"被点亮"
   * 的状态上——那正是用户说的"在已有颜色的键盘上改颜色"。
   */
  function glowBack(entry: KeyEntry): void {
    if (mode === 'showcase' && !stream) {
      entry.material.emissive.set('#ffb271');
      entry.material.emissiveIntensity = entry.level === 0 ? 0 : 0.03 + entry.level * 0.085;
    } else {
      entry.material.emissive.setRGB(0, 0, 0);
      entry.material.emissiveIntensity = 0;
    }
  }

  function updateLabels(): void {
    // 时间流逝与回放计数各自写数字，不走"热力读数"这一套。
    if (stream || replayActive) return;
    for (const [keyId, entry] of keys) {
      // 每颗键都印读数。主次不是靠"少印几个"拉开的，而是靠**键面字符的大小**：
      // 中性图集里的字符已经缩到只占上缘一小条，下方整片留给数字（见 make_neutral_atlas.py）。
      // 值为 0 的键不印——一片 0 会把真正在用的键淹掉。
      const show = mode === 'heat' && valueOf(keyId) > 0;
      entry.valueNode.textContent = show ? formatMetric(metric, valueOf(keyId)) : '';
      entry.label.style.display = show ? '' : 'none';
    }
  }

  /**
   * 只摆位置：把键帽中心投影到画布坐标，写 transform。
   *
   * 与 `layoutLabels` 分开是因为**相机随时可能变**：每帧重算字号要走
   * `offsetWidth`（强制回流），104 个键一次就要几毫秒；位置只需要一次投影矩阵乘法。
   * 字号沿用上一次布局算好的 `widthPx/offsetPx`。
   *
   * **半像素去重**：这条路径每帧都跑，而镜头一旦不动，位移就是 0。位移不到半像素就不写
   * DOM——写一次 CSS 变换要走样式重算 + 合成层更新，104 个键乘 60fps 是这笔账里最容易
   * 漏掉的一项（见 2026-10-31 的帧剖析：`placeLabels` 曾是 JS 侧第一）。镜头现在固定，
   * 于是这一句基本就是"整段跳过"。
   * `force` 用在必须对齐的时刻：首次布局、尺寸变化、seek 之后。
   */
  function placeLabels(force = false): void {
    if (!ready) return;
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    for (const entry of keys.values()) {
      const projected = scratch.copy(entry.center).project(camera);
      const x = (projected.x * 0.5 + 0.5) * width;
      let y = (-projected.y * 0.5 + 0.5) * height;
      // 读数落在键面下半部（字符在上缘）：往下挪约 1/4 键高。
      // 空格/Shift/Enter 这类长键例外——它们没有居中字符，读数居中更好看也更稳。
      let labelY = y + entry.offsetPx;
      if (entry.offsetPx > 0 && labelY > height - 24) labelY = y - entry.offsetPx * 0.8;
      y = Math.min(height - 18, Math.max(18, labelY));
      if (!force && Math.abs(x - entry.lastX) < 0.5 && Math.abs(y - entry.lastY) < 0.5) continue;
      entry.lastX = x;
      entry.lastY = y;
      entry.label.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
    }
  }

  /** 布局：算键宽、字号、读数偏移，然后摆一次位置。只在尺寸变化时跑。 */
  function layoutLabels(): void {
    if (!ready) return;
    const width = container.clientWidth || 1;
    const edge = new THREE.Vector3();
    const axial = new THREE.Vector3();
    for (const entry of keys.values()) {
      const projected = scratch.copy(entry.center).project(camera);
      edge.copy(entry.center).add(axial.set(entry.halfWidth, 0, 0)).project(camera);
      const keyWidthPx = Math.abs(edge.x - projected.x) * 0.5 * width;
      entry.widthPx = keyWidthPx;
      entry.offsetPx = keyWidthPx > 90 ? 0 : Math.min(8, keyWidthPx * 0.12);
      // 字号跟着键宽走；宽度收到键面以内，免得压到隔壁键。
      // **隐藏的标签也要先给一个字号**：时间流逝里它们在模型加载完时全是隐藏的，
      // 等第一次出现数字再算，第一帧会是继承来的 16px、直接压到隔壁键上。
      let size = Math.min(16, Math.max(9, keyWidthPx * 0.36));
      entry.label.style.fontSize = `${size}px`;
      if (entry.label.style.display === 'none') continue;
      const limit = keyWidthPx * 1.05;
      let guard = 0;
      while (entry.label.offsetWidth > limit && size > 8 && guard < 16) {
        size -= 0.5;
        entry.label.style.fontSize = `${size}px`;
        guard += 1;
      }
    }
    placeLabels(true);
  }

  function refresh(): void {
    applyLook();
    updateLabels();
    layoutLabels();
  }

  function setData(next: HeatmapResponse | null | undefined, nextMetric: string): void {
    metric = nextMetric;
    levels = modelLevels(next, nextMetric);
    values = new Map((next?.keys || []).map((key) => [key.id, key]));
    if (replayActive) {
      // 回放中途换 metric：色阶分母与读数都要按新的 metric 重算，全部键重画一遍。
      const meta = getReplayMeta();
      if (meta) replayP95 = Math.max(1, p95OfMetric(metric, meta.tally));
      for (const keyId of keys.keys()) replayDirty.add(keyId);
      return;
    }
    for (const [keyId, entry] of keys) entry.level = levels.get(keyId) ?? 0;
    if (ready) refresh();
  }

  function setMode(next: Keyboard3DMode): void {
    if (next === mode) return;
    mode = next;
    if (ready) refresh();
  }

  /**
   * 把一段文字写进键面读数，并按"键宽 ÷ 字符数"现算字号。
   *
   * 不走 `offsetWidth`：每帧测 104 个元素的宽度会强制回流，15Hz 下直接吃掉几毫秒。
   * 时间流逝与「播放今天」的计数都走这里——数字长度会变（3 位 → 6 位），字号得跟着缩。
   */
  function paintLabel(entry: KeyEntry, text: string): void {
    entry.valueNode.textContent = text;
    entry.label.style.display = text ? '' : 'none';
    if (!text) return;
    const width = entry.widthPx || 22;
    const length = Math.max(3, text.length);
    const byLength = (width * 1.04) / (length * 0.58);
    entry.label.style.fontSize = `${Math.max(6.5, Math.min(13, Math.min(width * 0.34, byLength)))}px`;
  }

  /**
   * 时间流逝上色：每颗键的累计次数 → 档位 → 颜色，并把数字写在键面上。
   *
   * 档位用**终值 p95**（流的最后一帧）当分母：动画结尾于是正好落在日常热力图的那套
   * 档位上，不会"放完一片红"。没按过的键不印数字、不上色——和视频里一样，白键就是白键。
   *
   * 这条路径按 15Hz 跑，成本全在"别做没用的事"上：
   *   - 次数没变（`lastCount`）就整格跳过，不调 `formatCount`；
   *   - 颜色/墨色在色阶变化时预先算成 `THREE.Color` 与 CSS 字符串，热路径上不再解析；
   *   - `material.needsUpdate` **只在换过贴图的那一次**置位。它是给 shader 重编用的，
   *     每帧置位会让 three 每帧重走一遍 `setProgram`（2026-10-31 帧剖析里
   *     `setProgram` + `refreshUniformsCommon` 的来路就是它）。
   */
  function applyStreamFrame(force = false): void {
    if (!stream || !streamCursor) return;
    const counts = streamCursor.counts;
    for (const [keyId, entry] of keys) {
      const at = streamIndex.get(keyId);
      const count = at === undefined ? 0 : counts[at];
      if (count !== entry.lastCount) {
        entry.lastCount = count;
        paintLabel(entry, count > 0 ? formatCount(count) : '');
      }
      const level = count > 0 ? Math.max(1, heatLevel(count / streamP95)) : 0;
      if (level === entry.level && !force) continue;
      entry.level = level;
      entry.material.color.copy(showColors[level] ?? showColors[0]);
      entry.material.emissive.setRGB(0, 0, 0);
      entry.material.emissiveIntensity = 0;
      // 贴图**从无到有**才算结构变化：装上中性图集那一次要重编 shader，之后就不必了。
      if (entry.material.map !== neutralMap) {
        entry.material.map = neutralMap;
        entry.material.needsUpdate = true;
      }
      entry.label.style.color = showInk[level] ?? showInk[0];
    }
  }

  /** 清掉"上一次印了什么"的缓存：换流/跳转时必须做，否则新读数会被当成"没变"跳过。 */
  function resetStreamCache(): void {
    for (const entry of keys.values()) {
      entry.lastCount = -1;
      entry.level = -1;
      entry.label.style.display = 'none';
      entry.valueNode.textContent = '';
    }
  }

  // ── 「播放今天」的计数舞台 ──────────────────────────────────────────────
  //
  // 用户 2026-10-31 的要求：`日常` 也要能从 0 涨起，"数字跟着回放增长、结束后停在今天的
  // 读数"。做法与时间流逝同源——按键时累加、按档位上色——但驱动是**回放的按键事件**
  // （`key:press:detail` 带按住时长），不是逐次流。
  //
  // 归一化的分母固定用**整段的终值 p95**（装载时算好），不用"当前这一帧的最大值"：
  // 后者会让颜色每帧重新归一，一颗键刚变深又被后来的键压回去。

  /** 这一帧把脏掉的键重画：数字 + 档位 + 颜色。 */
  function paintCount(entry: KeyEntry, keyId: string): void {
    const acc = replayAcc.get(keyId);
    const value = acc ? valueOfMetric(metric, acc) : 0;
    paintLabel(entry, value > 0 ? formatMetric(metric, value) : '');
    const level = value > 0 ? Math.max(1, heatLevel(value / replayP95)) : 0;
    if (level === entry.level) return;
    entry.level = level;
    applyKeyLook(entry);
  }

  /** 开播时把键面擦干净：全部回到"没按过"，颜色是冷键面。 */
  function blankCounts(): void {
    for (const [keyId, entry] of keys) {
      entry.level = 0;
      paintLabel(entry, '');
      applyKeyLook(entry);
      replayDirty.delete(keyId);
    }
  }

  /** 放完（或中途退出）回到这一页本该显示的读数：当前范围的热力图。 */
  function restoreHeatmap(): void {
    for (const [keyId, entry] of keys) entry.level = levels.get(keyId) ?? 0;
    applyLook();
    updateLabels();
  }

  /** 回放状态变了：开新的一段 / 结束一段。暂停与继续不动账。 */
  function onReplayState(state: ReplayState): void {
    const active = state.status === 'playing' || state.status === 'paused';
    if (active) {
      const meta = getReplayMeta();
      if (!meta) return;
      if (replayActive && meta.run === replayRun) return;
      replayActive = true;
      replayRun = meta.run;
      replayP95 = Math.max(1, p95OfMetric(metric, meta.tally));
      replayAcc = new Map();
      replayDirty.clear();
      if (ready) blankCounts();
      return;
    }
    if (!replayActive) return;
    replayActive = false;
    replayRun = -1;
    replayAcc = new Map();
    replayDirty.clear();
    if (ready) restoreHeatmap();
  }

  /** 回放放出一次按下：记账，标脏。动画那一路由 `key:press` 负责，不在这里。 */
  function accumulate(event: { key_id: string; d: number }): void {
    if (!replayActive) return;
    let acc = replayAcc.get(event.key_id);
    if (!acc) {
      acc = { count: 0, sumMs: 0, maxMs: 0 };
      replayAcc.set(event.key_id, acc);
    }
    acc.count += 1;
    const held = Number.isFinite(event.d) ? Math.max(0, event.d) : 0;
    acc.sumMs += held;
    if (held > acc.maxMs) acc.maxMs = held;
    if (keys.has(event.key_id)) replayDirty.add(event.key_id);
  }

  /**
   * 跳过空档：这一帧没有任何按下、而下一颗键还要等很久时，把数据时钟直接落到它身上。
   *
   * 为什么要跳：时间流逝里"时间"是数据时间，一天 4 秒。一天里真正有按键的只有十几个
   * 小时，剩下的夜里、午休、会议都没有输入——按真实比例放出来就是一段**一动不动**的
   * 死等，用户读到的却是"这一天的数字放完了，得等日期翻页才继续"（2026-10-31 原话）。
   * 空档里没有信息可看，跳过它不损失任何东西，反而让"日期翻页"和"数字继续涨"发生在
   * 同一瞬间。
   *
   * @returns 这一次跳过去额外放出的按下数（0 表示没跳）
   */
  function skipGap(data: PressStreamData, added: number): number {
    if (added > 0 || !stream || !streamCursor) return 0;
    const next = streamCursor.nextTime;
    // 没有下一颗键了：剩下的只是"这一天还没过完"，同样没有信息，直接走到结尾。
    const target = next ?? data.spanMs;
    const wallMs = ((target - streamCursor.offset) / stream.rate) * 1000;
    if (wallMs <= GAP_SKIP_WALL_MS) return 0;
    return streamCursor.advanceTo(target);
  }

  function setStream(next: KeyboardStreamSource | null): void {
    if (!next) {
      stream = null;
      streamCursor = null;
      streamIndex = new Map();
      streamSeekApplied = null;
      streamEnded = false;
      if (ready) refresh();
      return;
    }
    if (!stream || stream.data !== next.data || !streamCursor) {
      stream = next;
      streamCursor = new PressCursor(next.data);
      streamIndex = new Map(next.data.keys.map((keyId, index) => [keyId, index]));
      streamP95 = Math.max(1, next.data.p95);
      streamSeekApplied = null;
      streamEnded = false;
      // 从第一颗键按下开始：库里最早的月表可能比数据早好几天，别让动画先空转。
      streamCursor.seek(next.data.times.length ? next.data.times[0] : 0);
      streamLastFrame = performance.now();
      streamLastRefresh = 0;
      if (ready) {
        resetStreamCache();
        applyStreamFrame();
        placeLabels(true);
      }
      return;
    }
    const playingChanged = stream.playing !== next.playing;
    stream = next;
    // 暂停→继续时重置帧基准，否则暂停的那几秒会被算成一次大跳，一下刷出上万次按下。
    if (playingChanged) streamLastFrame = performance.now();
    if (next.seek !== null && next.seek !== streamSeekApplied) {
      streamSeekApplied = next.seek;
      streamCursor.seek(next.seek);
      streamEnded = false;
      if (ready) {
        resetStreamCache();
        applyStreamFrame();
        placeLabels(true);
      }
    }
  }

  /**
   * 水波：从键盘几何中心向四周散开的一次起伏。
   *
   * 每颗键按**到中心的距离**延迟起跳，于是一圈一圈荡开而不是整块板同时上下。
   * 幅度比真实按键深（4.2mm），因为这是开屏的一次表演，不是读数。
   */
  function ripple(): number {
    if (modelSize.lengthSq() === 0) return 0;
    const now = performance.now();
    let spread = 0;
    for (const entry of keys.values()) {
      const distance = Math.hypot(
        entry.center.x - modelCenter.x,
        entry.center.z - modelCenter.z,
      );
      const delay = distance * RIPPLE_DELAY_MS_PER_M;
      entry.rippleAt = now + delay;
      spread = Math.max(spread, delay);
    }
    return spread;
  }

  function press(keyId: string): void {
    const entry = keys.get(keyId);
    if (entry) entry.pressStart = performance.now();
  }

  function pick(event: PointerEvent): string | null {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickTargets, false);
    return hits.length ? (hits[0].object.userData.keyId as string) : null;
  }

  const onCanvasClick = (event: PointerEvent) => {
    const keyId = pick(event);
    if (keyId) callbacks.onSelect(keyId);
  };
  canvas.addEventListener('pointerup', onCanvasClick);

  const onCanvasMove = (event: PointerEvent) => {
    const keyId = pick(event);
    if (!keyId) {
      tip.hidden = true;
      return;
    }
    const key = values.get(keyId);
    const label = key?.label || keyId;
    const text = formatMetric(metric, valueOf(keyId));
    tip.textContent = `${label} · ${text}`;
    tip.hidden = false;
    const rect = container.getBoundingClientRect();
    // 贴着指针上方，左右各留 12px 别出框。
    const x = Math.min(Math.max(event.clientX - rect.left, 56), rect.width - 56);
    const y = event.clientY - rect.top;
    tip.style.transform = `translate(-50%, -140%) translate(${x}px, ${y}px)`;
  };
  const onCanvasLeave = () => {
    tip.hidden = true;
  };
  canvas.addEventListener('pointermove', onCanvasMove);
  canvas.addEventListener('pointerleave', onCanvasLeave);

  const resize = () => {
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    // 像素比按**像素预算**收：4K 屏 150% 缩放时 `dpr=1.5` 等于 1240 万像素，
    // 集成显卡光清一遍屏就要十几毫秒。超过约 400 万像素就往下收，且不低于 1。
    const wanted = Math.min(window.devicePixelRatio || 1, 2);
    const budget = Math.sqrt(4_000_000 / Math.max(1, width * height));
    renderer.setPixelRatio(Math.max(1, Math.min(wanted, budget)));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    fitCamera();
    layoutLabels();
    renderer.shadowMap.needsUpdate = true;
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  // 中性图集：和 glb 内嵌的那张同布局，只是底白、字深。flipY=false 才能和 glTF 的 UV 对齐。
  new THREE.TextureLoader().load(NEUTRAL_ATLAS_URL, (texture) => {
    if (disposed) return;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    neutralMap = texture;
    if (ready) refresh();
  });

  const loader = new GLTFLoader();
  loader.load(
    MODEL_URL,
    (gltf) => {
      if (disposed) return;
      scene.add(gltf.scene);
      gltf.scene.updateMatrixWorld(true);

      gltf.scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        // 键帽和上盖都参与投影：上盖在井口投一条暗边，键帽在定位板上落一圈小影——
        // "有没有影子跟着走"才是键帽上下动最直接的读数。
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const parsed = parseNodeName(mesh.name);
        if (!parsed) return; // 外壳、底板：保持原样

        const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        const material = (
          source instanceof THREE.MeshStandardMaterial ? source : new THREE.MeshStandardMaterial()
        ).clone();
        material.roughness = Math.min(material.roughness ?? 0.2, 0.34);
        material.metalness = 0;
        material.envMapIntensity = 0.9;
        mesh.material = material;
        mesh.userData.keyId = parsed.keyId;

        const label = document.createElement('div');
        label.className = 'keyboard-3d__label';
        const valueNode = document.createElement('span');
        valueNode.className = 'keyboard-3d__label-value';
        label.append(valueNode);
        layer.appendChild(label);

        keys.set(parsed.keyId, {
          mesh,
          material,
          originalMap: (material.map ?? null) as THREE.Texture | null,
          baseY: mesh.position.y,
          pressStart: null,
          rippleAt: null,
          center: new THREE.Vector3(),
          halfWidth: 0,
          widthPx: 0,
          offsetPx: 0,
          label,
          valueNode,
          level: 0,
          lastX: Number.NaN,
          lastY: Number.NaN,
          lastCount: -1,
        });
        pickTargets.push(mesh);
      });

      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      box.getCenter(modelCenter);
      modelSize.copy(size);

      // 阴影相机只罩住键盘本身。范围越小，2048 的贴图越密（约 4 像素/mm），
      // 键帽之间那 0.45mm 的缝才有影子可落。
      sun.target.position.copy(modelCenter);
      sun.position.copy(modelCenter).add(new THREE.Vector3(0.24, 0.62, 0.44));
      sun.shadow.camera.left = -modelSize.x * 0.6;
      sun.shadow.camera.right = modelSize.x * 0.6;
      sun.shadow.camera.top = modelSize.z * 1.15;
      sun.shadow.camera.bottom = -modelSize.z * 1.15;
      sun.shadow.camera.near = 0.05;
      sun.shadow.camera.far = 2.5;
      sun.shadow.camera.updateProjectionMatrix();
      sun.target.updateMatrixWorld();

      // 机身下方一块柔和落影，把"浮着"的键盘压住（浅卡上看得见，暗卡上自然隐去）。
      const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: softShadowTexture(),
          transparent: true,
          depthWrite: false,
          opacity: 0.5,
        }),
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.scale.set(modelSize.x * 1.15, modelSize.z * 1.7, 1);
      shadow.position.set(modelCenter.x, box.min.y - 0.0008, modelCenter.z);
      scene.add(shadow);

      // 每个键帽的世界中心与半宽，供数字叠层定位。
      for (const entry of keys.values()) {
        const keyBox = new THREE.Box3().setFromObject(entry.mesh);
        keyBox.getCenter(entry.center);
        entry.halfWidth = (keyBox.max.x - keyBox.min.x) / 2;
      }

      fitCamera();
      ready = true;
      renderer.shadowMap.needsUpdate = true;
      refresh();
      // 回放可能比模型先到：先把键面擦干净，再把已经攒下的账补画上去。
      if (replayActive) {
        blankCounts();
        for (const keyId of replayAcc.keys()) if (keys.has(keyId)) replayDirty.add(keyId);
      }
      // 时间流逝可能比模型先到：模型就位时补一帧，否则要等到下一次 66ms 节拍才有颜色。
      if (stream) {
        streamLastFrame = performance.now();
        applyStreamFrame();
        placeLabels();
      }
      if (!introDone) {
        introAt = performance.now();
        nextRippleAt = introAt + INTRO_MS + 160;
      }
      callbacks.onKeysLoaded([...keys.keys()]);
      callbacks.onReady();
    },
    undefined,
    () => {
      // 模型取不到（静态资源缺失）：交给宿主显示回退，不在这里瞎猜。
      callbacks.onError();
    },
  );

  const offPress = busOn<string[]>('key:press', (ids) => {
    for (const keyId of ids) press(keyId);
  });
  // 回放的记账通道：多带一个按住时长，只有"要把读数累加上去"的 3D 需要它。
  const offPressDetail = busOn<{ key_id: string; d: number }[]>('key:press:detail', (events) => {
    if (!Array.isArray(events)) return;
    for (const event of events) accumulate(event);
  });
  // 回放开关：直接订阅模块状态，**不经过 React**——回放进度是 5Hz，让整页跟着重渲染
  // 不值得，而且这条路径和 bus 一样是"绕过渲染"的。
  const offReplayChange = subscribeReplay(onReplayState);
  // 订阅不给"当前值"：场景可能是回放中途才建起来的（切 3D/平面、开完展示层回来），
  // 那种情况下也要立刻进入/退出计数状态。
  onReplayState(getReplay());

  const loop = () => {
    raf = window.requestAnimationFrame(loop);
    // 切到后台就什么都不做：标签页看不见时还在算 104 个投影、跑一遍阴影贴图，
    // 是笔记电池最长的那根管子。回来时把时钟基准拉平，避免一次大跳。
    if (document.hidden) {
      streamLastFrame = performance.now();
      return;
    }
    const now = performance.now();
    /** 这一帧有键帽真的动过吗？动过才重画阴影贴图（见下面的 `shadowMap.autoUpdate`）。 */
    let capsMoved = false;
    for (const entry of keys.values()) {
      if (entry.rippleAt !== null) {
        const wave = (now - entry.rippleAt) / RIPPLE_MS;
        if (wave >= 1) {
          entry.rippleAt = null;
          entry.mesh.position.y = entry.baseY;
          entry.mesh.scale.setScalar(1);
          glowBack(entry);
          capsMoved = true;
        } else if (wave >= 0 && !reduced) {
          const lift = Math.sin(Math.PI * wave);
          entry.mesh.position.y = entry.baseY + RIPPLE_DEPTH * lift;
          // 正视角度看不太出上下位移，所以再加两样能从顶上看见的：键帽被顶大一点点，
          // 以及一圈随波扫过的暖光。三样叠起来才是水面被点了一下。
          // 光要收着点（0.55）：光一强，眼睛就只看见"亮了一下"，反而盖掉了起伏本身。
          entry.mesh.scale.setScalar(1 + lift * 0.07);
          entry.material.emissive.set('#ffc489');
          entry.material.emissiveIntensity = lift * 0.55;
          capsMoved = true;
          continue;
        }
      }
      if (entry.pressStart === null) continue;
      const progress = (now - entry.pressStart) / PRESS_MS;
      if (progress >= 1) {
        entry.pressStart = null;
        entry.mesh.position.y = entry.baseY;
        entry.mesh.scale.setScalar(1);
        glowBack(entry);
        capsMoved = true;
      } else if (reduced) {
        // 减少动态：不下沉，改用一次高光回弹。
        entry.material.emissive.setRGB(1, 1, 1);
        entry.material.emissiveIntensity = (1 - progress) * 0.45;
      } else {
        // 下沉 + 一点点收缩 + 一次暖光。**三样都要**：俯视角下只看得到 1.6mm 的下沉，
        // 而"播放今天"在「日常」那套热力色上也必须看得出来（用户 2026-10-31 的原话是
        // "日常页面没效果"）。这里刻意**不动色相**，只叠一层短促的暖光——在已经有颜色的
        // 键盘上改颜色只会让人以为读数变了。
        const pulse = Math.sin(Math.PI * progress);
        entry.mesh.position.y = entry.baseY - PRESS_DEPTH * pulse;
        entry.mesh.scale.setScalar(1 - pulse * 0.045);
        entry.material.emissive.set(PRESS_GLOW);
        entry.material.emissiveIntensity = pulse * 0.7;
        capsMoved = true;
      }
    }
    // 键帽没动 → 阴影贴图这一帧一定和上一帧一样，不必重画（2048² 的一次完整投影）。
    if (capsMoved) renderer.shadowMap.needsUpdate = true;

    // 「播放今天」：只重画这一帧真的变过读数的键（通常 1–3 颗）。
    if (replayActive && replayDirty.size) {
      for (const keyId of replayDirty) {
        const entry = keys.get(keyId);
        if (entry) paintCount(entry, keyId);
      }
      replayDirty.clear();
    }

    // 开屏运镜：从远拉近，落位后停下不动（水波要在静止的键盘上才看得清）。
    if (ready && !introDone && fitDistance > 0) {
      const t = Math.min(1, (now - introAt) / INTRO_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      const distance = fitDistance * (1 + (INTRO_START_SCALE - 1) * (1 - eased));
      camera.position.copy(modelCenter).addScaledVector(CAMERA_DIRECTION, distance);
      camera.lookAt(modelCenter);
      camera.updateMatrixWorld();
      if (t >= 1) {
        introDone = true;
        // 落位后立刻放水波：这是"拉近之后再加载水波动画"的时序。
        nextRippleAt = now + 60;
      }
    }
    // 落位之后镜头就**固定**了。早先「展示」观感里还有一段 ±1.5°、周期 52 秒的缓慢摆动，
    // 2026-10-31 按用户要求去掉了：键面读数是按相机投影摆上去的，镜头一动，数字就得每帧
    // 重投影（还会轻微漂），而这一整页要的正是"读数稳定"。运镜只留在开屏那一次。

    // 水波：开屏落位后放一次；演完（最后一片涟漪也回到原位）再通知宿主收浮层。
    if (ready && ripplesLeft > 0 && now >= nextRippleAt) {
      const spread = ripple();
      ripplesLeft -= 1;
      introRippleEnd = now + spread + RIPPLE_MS;
    }
    if (intro && !introNotified && introRippleEnd > 0 && now >= introRippleEnd) {
      introNotified = true;
      callbacks.onIntroEnd();
    }

    // 时间流逝：推进数据时钟，按 15Hz 刷新键面。**镜头固定**（用户 2026-10-31：
    // "键盘不用旋转，固定视角"）——镜头一动，键面数字就要跟着重投影，读数也晃。
    if (stream && streamCursor && ready && fitDistance > 0) {
      const data = stream.data;
      /** 这一帧真的新增了按下吗？没有新按下时键面上的读数不会变，别白刷 104 格。 */
      let added = 0;
      if (stream.playing && !streamEnded) {
        // 与回放同一条规矩：单帧最多推进 100ms，切后台回来不会一口气倒出上万次按下。
        const delta = Math.min(100, Math.max(0, now - streamLastFrame));
        streamLastFrame = now;
        // 速率是"数据毫秒 / 真实秒"，这里 delta 是真实毫秒，所以除 1000。
        const offset = streamCursor.offset + (delta / 1000) * stream.rate;
        added = streamCursor.advanceTo(Math.min(offset, data.spanMs));
        // **空档直接跳过去**：一段结束后的夜里、或两段会话之间，画面会一动不动地等，
        // 而用户看到的是"这一天的数字放完了，得等左上角的日期翻页才继续"。这段时间
        // 没有信息，按真实时间放它只会变成一段死等——所以超过 GAP_SKIP_WALL_MS 的
        // 空档直接落到下一颗键上，日期跟着一起跳。
        added += skipGap(data, added);
        if (streamCursor.offset >= data.spanMs) {
          streamEnded = true;
          callbacks.onStreamEnd();
        }
      } else {
        // 暂停/结束时持续把基准拉到 now，继续播放的第一帧才不会跳。
        streamLastFrame = now;
      }
      // 暂停且没有新按下 → 画面逐字节相同，连投影和重绘都可以省掉。
      if (stream.playing || added > 0) {
        // 镜头不动，标签的投影结果也就不变；这次调用里绝大多数键会被半像素去重直接跳过。
        placeLabels();
        if (now - streamLastRefresh >= STREAM_REFRESH_MS) {
          streamLastRefresh = now;
          // 没有新按下时键面读数不会变，只走读数（进度的刻度得一直动）。
          if (added > 0) applyStreamFrame();
          const dayIndex = dayIndexAt(data, streamCursor.offset);
          callbacks.onStreamTick({
            offsetMs: streamCursor.offset,
            total: streamCursor.total,
            dayIndex,
            date: data.days[dayIndex]?.date || data.from,
            playing: stream.playing && !streamEnded,
          });
        }
      }
    }

    renderer.render(scene, camera);
  };
  raf = window.requestAnimationFrame(loop);

  return {
    setData,
    setMode,
    setStream,
    refreshColors() {
      ramp = cssHeatRamp();
      showRamp = cssShowRamp();
      showColors = showRamp.map((color) => new THREE.Color(color));
      showInk = showRamp.map((color) => inkFor(color));
      if (ready) refresh();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      offPress();
      offPressDetail();
      offReplayChange();
      observer.disconnect();
      canvas.removeEventListener('pointerup', onCanvasClick);
      canvas.removeEventListener('pointermove', onCanvasMove);
      canvas.removeEventListener('pointerleave', onCanvasLeave);
      layer.remove();
      tip.remove();
      neutralMap?.dispose();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose();
      });
      renderer.dispose();
      environment.dispose();
      pmrem.dispose();
      canvas.remove();
    },
  };
}

export function Keyboard3D({
  heatmap,
  metric,
  mode = 'heat',
  intro = false,
  stream = null,
  onIntroEnd = null,
  onSelectKey = null,
  onKeysLoaded = null,
  onStreamTick = null,
  onStreamEnd = null,
}: Keyboard3DProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const selectRef = useRef(onSelectKey);
  selectRef.current = onSelectKey;
  const keysLoadedRef = useRef(onKeysLoaded);
  keysLoadedRef.current = onKeysLoaded;
  const introEndRef = useRef(onIntroEnd);
  introEndRef.current = onIntroEnd;
  const streamTickRef = useRef(onStreamTick);
  streamTickRef.current = onStreamTick;
  const streamEndRef = useRef(onStreamEnd);
  streamEndRef.current = onStreamEnd;
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let scene: SceneHandle;
    try {
      // 初始观感在创建时就传进去：否则模型加载完的那一帧会先按 heat 画一遍读数，
      // 再被 mode 的 effect 擦掉——展示模式会闪一下满屏数字。
      scene = createKeyboardScene(
        element,
        {
          onSelect: (keyId) => selectRef.current?.(keyId),
          onReady: () => setReady(true),
          onError: () => setError('3D 模型加载失败'),
          onKeysLoaded: (keyIds) => keysLoadedRef.current?.(keyIds),
          onIntroEnd: () => introEndRef.current?.(),
          onStreamTick: (tick) => streamTickRef.current?.(tick),
          onStreamEnd: () => streamEndRef.current?.(),
        },
        mode,
        intro,
      );
    } catch {
      setError('当前环境不支持 WebGL，3D 键盘无法渲染');
      return;
    }
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
    // mode 只在首次创建时读一次；之后由下面那个 effect 负责切换。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ready) sceneRef.current?.setData(heatmap, metric);
  }, [ready, heatmap, metric]);

  useEffect(() => {
    if (ready) sceneRef.current?.setMode(mode);
  }, [ready, mode]);

  // 时间流逝：`stream` 由宿主 useMemo 保持稳定；这里每次变化都重新喂一遍，
  // 播放/暂停、倍速、seek 都是同一个入口。
  useEffect(() => {
    sceneRef.current?.setStream(stream);
  }, [ready, stream]);

  return (
    <div
      className={`keyboard-3d keyboard-3d--${mode}`}
      ref={host}
      role="img"
      aria-label={
        stream
          ? '3D 猫耳键盘的时间流逝：按真实按键顺序累加，键面显示累计次数'
          : '3D 猫耳键盘热力图；固定视角，点击键位查看详情，完整读数见下方表格视图'
      }
    >
      {error ? <div className="keyboard-3d__fallback">{error}</div> : null}
    </div>
  );
}
