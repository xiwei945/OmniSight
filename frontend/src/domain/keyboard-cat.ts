// 猫耳键盘（`keyboard.glb`，104 键）的节点契约与热力配色。
//
// 这份模型由 `keycap_atlas.py` / `build_keyboard_glb.py` 生成：**一键一个 mesh**，节点名形如
// `Esc_r0_choco`、`LShift_r4_cream`——`_r<行>_<配色分区>` 是几何生成时写进去的，不是 key_id。
// 因此这里必须自带一张「节点名 → key_id」的对照表；它和 `capture/keymap.py` 的 `_DEFINITIONS`
// 一一对应，漏一个键的表现是那颗键永远显示 0，而不是报错——所以 `tests/frontend/keyboard-cat.test.ts`
// 拿模型里真实存在的节点名逐个核对。
//
// 纯函数 + 纯数据，零 three 依赖（配色读取走注入的取值函数），`node --experimental-strip-types` 下可测。
import type { HeatmapResponse } from '../types/api.d.ts';
import { heatLevel, heatRatio } from './metrics.ts';

/** 模型文件在静态资源里的地址。 */
export const MODEL_URL = '/static/assets/keyboard.glb';
/** 中性图集：白底深字。日常热力视图靠它把底色交给运行时（`material.color`）。 */
export const NEUTRAL_ATLAS_URL = '/static/assets/keycap_atlas_neutral.png';

/** 键帽分区。`grey` 是 PrtSc/ScrLk/Pause 三颗浅灰键，`blue` 是 R/U 两颗撞色键。 */
export type Zone = 'cream' | 'choco' | 'grey' | 'blue';

const ZONES: readonly Zone[] = ['cream', 'choco', 'grey', 'blue'];

/** 节点名里 `_r<行>_<分区>` 的后缀。行号只用于生成时排版，取键位时不需要。 */
const SUFFIX = /^(?<label>.+?)_r\d+_(?<zone>cream|choco|grey|blue)$/;

/**
 * 图集/模型里的字符名 → `key_id`。**左边是模型节点的前缀**，右边是数据库里的稳定标识。
 *
 * 两套命名不一样是历史原因：模型侧沿用参考键盘的图例名（`LShift`、`Num0`、`PrtSc`），
 * 数据侧是 `shift_left`、`numpad_0`、`print_screen`。这张表就是那道翻译。
 */
export const KEY_ID_BY_LABEL: Readonly<Record<string, string>> = {
  Esc: 'esc',
  ...Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => [`F${index + 1}`, `f${index + 1}`]),
  ),
  Grave: 'grave',
  ...Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`${index}`, `digit${index}`])),
  Minus: 'minus',
  Equal: 'equal',
  Backspace: 'backspace',
  Tab: 'tab',
  ...Object.fromEntries(
    'QWERTYUIOP'.split('').map((letter) => [letter, `key_${letter.toLowerCase()}`]),
  ),
  LBracket: 'bracket_left',
  RBracket: 'bracket_right',
  Backslash: 'backslash',
  CapsLock: 'caps_lock',
  ...Object.fromEntries(
    'ASDFGHJKL'.split('').map((letter) => [letter, `key_${letter.toLowerCase()}`]),
  ),
  Semicolon: 'semicolon',
  Quote: 'quote',
  Enter: 'enter',
  LShift: 'shift_left',
  ...Object.fromEntries(
    'ZXCVBNM'.split('').map((letter) => [letter, `key_${letter.toLowerCase()}`]),
  ),
  Comma: 'comma',
  Period: 'period',
  Slash: 'slash',
  RShift: 'shift_right',
  LCtrl: 'control_left',
  LWin: 'win_left',
  LAlt: 'alt_left',
  Space: 'space',
  RAlt: 'alt_right',
  RWin: 'win_right',
  Menu: 'menu',
  RCtrl: 'control_right',
  PrtSc: 'print_screen',
  ScrLk: 'scroll_lock',
  Pause: 'pause',
  Insert: 'insert',
  Home: 'home',
  PageUp: 'page_up',
  Delete: 'delete',
  End: 'end',
  PageDown: 'page_down',
  Up: 'arrow_up',
  Left: 'arrow_left',
  Down: 'arrow_down',
  Right: 'arrow_right',
  NumLock: 'num_lock',
  NumSlash: 'numpad_divide',
  NumAsterisk: 'numpad_multiply',
  NumMinus: 'numpad_subtract',
  NumPlus: 'numpad_add',
  NumEnter: 'numpad_enter',
  NumDot: 'numpad_decimal',
  ...Object.fromEntries(
    Array.from({ length: 10 }, (_, index) => [`Num${index}`, `numpad_${index}`]),
  ),
};

export interface CatNode {
  keyId: string;
  zone: Zone;
  /** 图例名（`LShift`、`Num0`），仅用于调试与测试。 */
  label: string;
}

/**
 * 解析一个键帽节点名。外壳节点（`Case_Floor`、`Plate`、`KeyboardRoot`）返回 `null`。
 *
 * 名字对不上 `KEY_ID_BY_LABEL` 也返回 `null`：宁可这颗键不上色，也不要猜错键位——猜错
 * 的表现是"我明明没按 Esc，Esc 却红了"，比空着难查得多。
 */
export function parseNodeName(name: string | null | undefined): CatNode | null {
  if (!name) return null;
  const match = SUFFIX.exec(name);
  if (!match?.groups) return null;
  const { label, zone } = match.groups as { label: string; zone: Zone };
  if (!ZONES.includes(zone)) return null;
  const keyId = KEY_ID_BY_LABEL[label];
  if (!keyId) return null;
  return { keyId, zone, label };
}

/** 0 档（没按过）的键面本色：与图集的中性底一致，避免"空键"看着像缺了一块。 */
export const COLD_FACE = '#f2ece1';

/** CSS 读不到 `--heat-*` 时的兜底：奶油拿铁那一套。 */
const HEAT_FALLBACK = ['#e8cfa8', '#d9b078', '#c0884b', '#9c5f2b', '#6e3b16'];

/**
 * 六档热力色（0 = 没按过）。1–5 档**优先读 `--kb-heat-*`**——那是一条只给 3D 键帽用的
 * 色阶，深浅主题共用一套：键帽是浅色实物，深色主题若跟着反相，零档会和最常按的键一样亮，
 * 热力图就读不出方向了。读不到再退回 `--heat-*`（2D 格子那套）。
 */
export function heatRamp(read: (name: string) => string = () => ''): string[] {
  const steps = HEAT_FALLBACK.map((fallback, index) => {
    const level = index + 1;
    return read(`--kb-heat-${level}`).trim() || read(`--heat-${level}`).trim() || fallback;
  });
  return [COLD_FACE, ...steps];
}

/** 每个键帽该着哪一档色。与 2D 键面、年历格子共用 `heatRatio` + `heatLevel`。 */
export function modelLevels(
  heatmap: HeatmapResponse | null | undefined,
  metric: string,
): Map<string, number> {
  const levels = new Map<string, number>();
  const scale = heatmap?.scale ?? null;
  for (const key of heatmap?.keys || []) {
    const value = Number((key as unknown as Record<string, unknown>)[metric]) || 0;
    levels.set(key.id, heatLevel(heatRatio(value, scale)));
  }
  return levels;
}

/**
 * 键面读数该用什么字色。热力档位越深，字越要翻白——否则深焦糖上印深棕字，等于没印。
 * 阈值取 sRGB 相对亮度的 0.5（#c0884b 约 0.45，翻白；#d9b078 约 0.55，留深字）。
 */
export function inkFor(hex: string): string {
  const value = hex.replace('#', '');
  if (value.length !== 6) return '#3a322b';
  const channel = (offset: number) => {
    const srgb = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.5 ? '#3a322b' : '#fff8ef';
}
