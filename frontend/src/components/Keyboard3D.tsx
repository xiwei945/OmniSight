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
import { prefersReducedMotion } from '../core/theme.ts';
import { formatMetric } from '../domain/metrics.ts';
import {
  MODEL_URL,
  NEUTRAL_ATLAS_URL,
  heatRamp,
  inkFor,
  modelLevels,
  parseNodeName,
} from '../domain/keyboard-cat.ts';
import type { HeatmapKey, HeatmapResponse } from '../types/api.d.ts';

/** 渲染模式：日常染色 / 展示发光。 */
export type Keyboard3DMode = 'heat' | 'showcase';

/** 按下动画时长。 */
const PRESS_MS = 170;
/** 下沉深度（模型单位 = 米）。键帽本身高 4mm，沉 1.6mm 是明显的 40%。 */
const PRESS_DEPTH = 0.0016;


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
  label: HTMLDivElement;
  valueNode: HTMLSpanElement;
  level: number;
}

interface SceneHandle {
  setData: (heatmap: HeatmapResponse | null | undefined, metric: string) => void;
  setMode: (mode: Keyboard3DMode) => void;
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
}

export interface Keyboard3DProps {
  heatmap: HeatmapResponse | null | undefined;
  metric: string;
  mode?: Keyboard3DMode;
  /** 开屏用：从远处拉近 + 放一轮水波。日常进页不要开。 */
  intro?: boolean;
  /** 开屏动画（运镜 + 水波）演完时回调一次。宿主据此收浮层。 */
  onIntroEnd?: (() => void) | null;
  onSelectKey?: ((keyId: string) => void) | null;
  /** 模型加载完回报它实际带的键位，供视图核对当前布局里有没有键位不在模型上。 */
  onKeysLoaded?: ((keyIds: string[]) => void) | null;
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
  const UP = new THREE.Vector3(0, 1, 0);
  const swayDirection = new THREE.Vector3();

  const keys = new Map<string, KeyEntry>();
  const pickTargets: THREE.Mesh[] = [];
  const reduced = prefersReducedMotion();

  let ramp = cssHeatRamp();
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
   */
  function applyLook(): void {
    for (const entry of keys.values()) {
      const level = entry.level;
      const color = ramp[level] ?? ramp[0];
      if (mode === 'heat') {
        entry.material.map = neutralMap;
        entry.material.color.set(color);
        entry.material.emissive.set('#000000');
        entry.material.emissiveIntensity = 0;
        entry.label.style.color = inkFor(color);
      } else {
        entry.material.map = entry.originalMap;
        entry.material.color.set('#ffffff');
        // 发光用**固定的暖光**而不是热力色本身：色阶最热那两档是深咖，让它自发光
        // 等于发一团黑光，越热反而越暗。亮度按档位抬，颜色始终是灯的颜色。
        entry.material.emissive.set('#ffb271');
        entry.material.emissiveIntensity = level === 0 ? 0 : 0.03 + level * 0.085;
        entry.label.style.color = '#fff8ef';
      }
      entry.material.needsUpdate = true;
    }
  }

  function updateLabels(): void {
    for (const [keyId, entry] of keys) {
      // 每颗键都印读数。主次不是靠"少印几个"拉开的，而是靠**键面字符的大小**：
      // 中性图集里的字符已经缩到只占上缘一小条，下方整片留给数字（见 make_neutral_atlas.py）。
      // 值为 0 的键不印——一片 0 会把真正在用的键淹掉。
      const show = mode === 'heat' && valueOf(keyId) > 0;
      entry.valueNode.textContent = show ? formatMetric(metric, valueOf(keyId)) : '';
      entry.label.style.display = show ? '' : 'none';
    }
  }

  /** 把每个键帽中心投影到画布坐标，摆好数字；顺带按投影宽度收字号，免得长数字溢出键面。 */
  function layoutLabels(): void {
    if (!ready) return;
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    const edge = new THREE.Vector3();
    for (const entry of keys.values()) {
      const projected = entry.center.clone().project(camera);
      const x = (projected.x * 0.5 + 0.5) * width;
      let y = (-projected.y * 0.5 + 0.5) * height;
      edge.copy(entry.center).add(new THREE.Vector3(entry.halfWidth, 0, 0)).project(camera);
      const keyWidthPx = Math.abs(edge.x - projected.x) * 0.5 * width;
      // 读数落在键面下半部（字符在上缘）：往下挪约 1/4 键高。
      // 空格/Shift/Enter 这类长键例外——它们没有居中字符，读数居中更好看也更稳。
      const offset = keyWidthPx > 90 ? 0 : Math.min(8, keyWidthPx * 0.12);
      let labelY = y + offset;
      if (offset > 0 && labelY > height - 24) labelY = y - offset * 0.8;
      y = Math.min(height - 18, Math.max(18, labelY));
      entry.label.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
      if (entry.label.style.display === 'none') continue;
      // 字号跟着键宽走；宽度收到键面以内，免得压到隔壁键。
      let size = Math.min(16, Math.max(9, keyWidthPx * 0.36));
      entry.label.style.fontSize = `${size}px`;
      const limit = keyWidthPx * 1.05;
      let guard = 0;
      while (entry.label.offsetWidth > limit && size > 8 && guard < 16) {
        size -= 0.5;
        entry.label.style.fontSize = `${size}px`;
        guard += 1;
      }
    }
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
    for (const [keyId, entry] of keys) entry.level = levels.get(keyId) ?? 0;
    if (ready) refresh();
  }

  function setMode(next: Keyboard3DMode): void {
    if (next === mode) return;
    mode = next;
    if (ready) refresh();
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
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    fitCamera();
    layoutLabels();
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
          label,
          valueNode,
          level: 0,
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
      refresh();
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

  const loop = () => {
    raf = window.requestAnimationFrame(loop);
    const now = performance.now();
    for (const entry of keys.values()) {
      if (entry.rippleAt !== null) {
        const wave = (now - entry.rippleAt) / RIPPLE_MS;
        if (wave >= 1) {
          entry.rippleAt = null;
          entry.mesh.position.y = entry.baseY;
          entry.mesh.scale.setScalar(1);
          entry.material.emissiveIntensity = 0;
        } else if (wave >= 0 && !reduced) {
          const lift = Math.sin(Math.PI * wave);
          entry.mesh.position.y = entry.baseY + RIPPLE_DEPTH * lift;
          // 正视角度看不太出上下位移，所以再加两样能从顶上看见的：键帽被顶大一点点，
          // 以及一圈随波扫过的暖光。三样叠起来才是水面被点了一下。
          // 光要收着点（0.55）：光一强，眼睛就只看见"亮了一下"，反而盖掉了起伏本身。
          entry.mesh.scale.setScalar(1 + lift * 0.07);
          entry.material.emissive.set('#ffc489');
          entry.material.emissiveIntensity = lift * 0.55;
          continue;
        }
      }
      if (entry.pressStart === null) continue;
      const progress = (now - entry.pressStart) / PRESS_MS;
      if (progress >= 1) {
        entry.pressStart = null;
        entry.mesh.position.y = entry.baseY;
        entry.material.emissiveIntensity = 0;
      } else if (reduced) {
        // 减少动态：不下沉，改用一次高光回弹。
        entry.material.emissive.setRGB(1, 1, 1);
        entry.material.emissiveIntensity = (1 - progress) * 0.45;
      } else {
        entry.mesh.position.y = entry.baseY - PRESS_DEPTH * Math.sin(Math.PI * progress);
      }
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
    } else if (
      ready &&
      mode === 'showcase' &&
      !reduced &&
      fitDistance > 0 &&
      (!intro || (introRippleEnd > 0 && now >= introRippleEnd))
    ) {
      // 展示模式：相机极缓慢地左右摆 1.5°（周期约 52 秒）。要等开屏水波演完再开始，
      // 否则镜头在动、键帽在起伏，两层动画互相打。日常模式不动——
      // 那张图要读数，视角一转键面数字就废了（见文件头）。
      const sway = Math.sin(now * 0.00012) * 0.026;
      swayDirection.copy(CAMERA_DIRECTION).applyAxisAngle(UP, sway);
      camera.position.copy(modelCenter).addScaledVector(swayDirection, fitDistance);
      camera.lookAt(modelCenter);
      camera.updateMatrixWorld();
    }

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

    renderer.render(scene, camera);
  };
  raf = window.requestAnimationFrame(loop);

  return {
    setData,
    setMode,
    refreshColors() {
      ramp = cssHeatRamp();
      if (ready) refresh();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      offPress();
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
  onIntroEnd = null,
  onSelectKey = null,
  onKeysLoaded = null,
}: Keyboard3DProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const selectRef = useRef(onSelectKey);
  selectRef.current = onSelectKey;
  const keysLoadedRef = useRef(onKeysLoaded);
  keysLoadedRef.current = onKeysLoaded;
  const introEndRef = useRef(onIntroEnd);
  introEndRef.current = onIntroEnd;
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

  return (
    <div
      className={`keyboard-3d keyboard-3d--${mode}`}
      ref={host}
      role="img"
      aria-label="3D 猫耳键盘热力图；固定视角，点击键位查看详情，完整读数见下方表格视图"
    >
      {error ? <div className="keyboard-3d__fallback">{error}</div> : null}
    </div>
  );
}
