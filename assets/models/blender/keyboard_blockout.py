# -*- coding: utf-8 -*-
"""
keyboard_blockout.py  ·  v2 (全尺寸 104 键)
==========================================
在 Blender 里一键生成"尺寸正确"的键盘 blockout（白模）。

用法：
  1) Blender 4.x -> Scripting 工作区 -> 打开本文件 -> Run Script
  2) 或命令行：  blender -b -P keyboard_blockout.py

设计意图（整份方案的核心思想）：
  AI 负责"好看"，本脚本负责"尺寸对"。
  所有零件尺寸都从 19.05mm 这个物理常量推导出来，所以后面无论
  走渲染、游戏引擎还是 3D 打印，比例都不会崩。

场景单位：1 Blender Unit = 1 mm  (unit_settings.scale_length = 0.001)
"""

from __future__ import annotations
import math

# ---------------------------------------------------------------- #
# 1. 常量：键盘是精密件，这些数字不是随便写的
# ---------------------------------------------------------------- #
PITCH = 19.05            # 1u 键距(mm) —— 键盘界的物理常数，千万别改
KEY_GAP = 0.8            # 键帽之间留缝(mm)
TAPER = 0.9              # 键帽顶部每边内缩(mm)，做出拔模角
STEM_D = 4.0             # 轴座直径示意(mm)

# 键帽高度(profile)预设。参考图是 MAO 高度：
# 各排几乎等高、顶面大、边角圆润、表面亮光，和 OEM 那种"下排明显更高"完全不同。
PROFILE = "MAO"
PROFILES = {
    # 名称:        (每边内缩, 逐排高度 R1..R6)
    "OEM":   {"taper": 1.6, "heights": (9.5, 9.5, 9.6, 9.8, 10.6, 11.2)},
    "Cherry": {"taper": 1.4, "heights": (8.9, 9.0, 9.1, 9.4, 10.0, 10.2)},
    "MAO":   {"taper": 0.9, "heights": (10.2, 10.2, 10.3, 10.4, 10.6, 10.8)},
    "XDA":   {"taper": 0.7, "heights": (9.0, 9.0, 9.0, 9.0, 9.0, 9.0)},
    "SA":    {"taper": 2.0, "heights": (12.0, 12.5, 13.0, 13.5, 14.5, 16.0)},
}
CASE_WALL = 2.5          # 外壳壁厚(mm)
CASE_BEZEL = 8.0         # 外壳四边留边(mm)
CASE_H = 18.0            # 外壳高度(mm)
PLATE_T = 1.5            # 定位板厚度(mm)
CASE_FLOOR_T = 3.0       # 底壳厚度(mm)
BEVEL = 0.35             # 键帽倒角(mm)

# ---- 猫耳键帽（形状按实拍确认）----
# 结论：俯视轮廓仍是圆角方块，"猫"只体现在顶面的高度场上：
#   后缘两侧隆起成耳、两耳之间下凹、边缘一条柔和滚边。
CAT_EARS = True
BUILD_SWITCHES = False   # 轴座代理件：网页里看不见，默认不建（省 104 个节点）
EAR_H = 2.00             # 耳尖高出顶面(mm)
EAR_DIP = 1.10           # 两耳之间下凹深度(mm)
EAR_POS = 0.62           # 耳峰归一化位置(±1 = 键帽边缘)
EAR_WIDTH = 0.26         # 耳峰宽度
DIP_WIDTH = 0.32         # 中间凹槽宽度
DISH = 0.30              # 顶面整体锅底凹陷(mm)
SE_N = 3.8               # 超椭圆指数，3.8 接近实拍的圆角方块
R_TOP = 2.45             # 顶部圆角(mm)
R_BOT = 1.10             # 底部圆角(mm)
# 分段数：按桌面 WebGL 预算定的，1u 约 2000 三角面。
# 86 颗 1u 共享同一份网格，全部实例化后总面数约 21 万，桌面无压力。
# 要上移动端就把这三个数除以 2，形体会略钝但能省一半。
SEG_A = 64               # 环向分段（顶面圆润度主要靠它）
SEG_K = 12               # 纵向分段
TOP_STEPS = 8            # 顶盖极坐标圈数（余弦分布，边缘更密）

# ---------------------------------------------------------------- #
# 2. 布局表
#    格式：每一排 = [ (起始位置u, [(标签, 宽u[, 高u]), ...]), ... ]
#    - 起始位置以"u"为单位，从键盘左边缘算起
#    - 标签为 None 表示这是个空位（间距），不生成键
#    - 高u 默认 1；2u 高的键（如小键盘 + / Enter）写 2
#    想换 60% / 65% / TKL，只改下面这张表，几何代码一行都不用动。
# ---------------------------------------------------------------- #

# --- 全尺寸 104 键（ANSI，含 F 区 / 导航区 / 小键盘）----------------
MAIN_U = 15.0
BLOCK_GAP_U = 0.25
NAV_U = 3.0
NUM_U = 4.0
NAV_X = MAIN_U + BLOCK_GAP_U            # 15.25
NUM_X = NAV_X + NAV_U + BLOCK_GAP_U     # 18.50
FULL_W_U = NUM_X + NUM_U                # 22.50  (= 428.6 mm)

LAYOUT_FULL = [
    # 第 0 排：F 区（Esc 后留 1u，四键一组间隔 0.5u）+ 导航上排
    #   小键盘这排是空的 —— NumLock 行与数字排同高，这才是全尺寸的标准排法。
    [(0.0, [("Esc", 1.0), (None, 1.0),
            ("F1", 1.0), ("F2", 1.0), ("F3", 1.0), ("F4", 1.0), (None, 0.5),
            ("F5", 1.0), ("F6", 1.0), ("F7", 1.0), ("F8", 1.0), (None, 0.5),
            ("F9", 1.0), ("F10", 1.0), ("F11", 1.0), ("F12", 1.0)]),
     (NAV_X, [("PrtSc", 1.0), ("ScrLk", 1.0), ("Pause", 1.0)])],

    # 第 1 排：数字排 + Ins/Home/PgUp + 小键盘 NumLock 行
    [(0.0, [("Grave", 1.0), ("1", 1.0), ("2", 1.0), ("3", 1.0), ("4", 1.0),
            ("5", 1.0), ("6", 1.0), ("7", 1.0), ("8", 1.0), ("9", 1.0),
            ("0", 1.0), ("Minus", 1.0), ("Equal", 1.0), ("Backspace", 2.0)]),
     (NAV_X, [("Insert", 1.0), ("Home", 1.0), ("PageUp", 1.0)]),
     (NUM_X, [("NumLock", 1.0), ("NumSlash", 1.0),
              ("NumAsterisk", 1.0), ("NumMinus", 1.0)])],

    # 第 2 排：Tab 排 + Del/End/PgDn + 7 8 9 +
    [(0.0, [("Tab", 1.5), ("Q", 1.0), ("W", 1.0), ("E", 1.0), ("R", 1.0),
            ("T", 1.0), ("Y", 1.0), ("U", 1.0), ("I", 1.0), ("O", 1.0),
            ("P", 1.0), ("LBracket", 1.0), ("RBracket", 1.0), ("Backslash", 1.5)]),
     (NAV_X, [("Delete", 1.0), ("End", 1.0), ("PageDown", 1.0)]),
     (NUM_X, [("Num7", 1.0), ("Num8", 1.0), ("Num9", 1.0),
              ("NumPlus", 1.0, 2)])],

    # 第 3 排：Caps 排 + 4 5 6（+ 键跨 2~3 排右列）
    [(0.0, [("CapsLock", 1.75), ("A", 1.0), ("S", 1.0), ("D", 1.0), ("F", 1.0),
            ("G", 1.0), ("H", 1.0), ("J", 1.0), ("K", 1.0), ("L", 1.0),
            ("Semicolon", 1.0), ("Quote", 1.0), ("Enter", 2.25)]),
     (NUM_X, [("Num4", 1.0), ("Num5", 1.0), ("Num6", 1.0)])],

    # 第 4 排：Shift 排 + ↑ + 1 2 3 Enter(2u 高，跨底排)
    [(0.0, [("LShift", 2.25), ("Z", 1.0), ("X", 1.0), ("C", 1.0), ("V", 1.0),
            ("B", 1.0), ("N", 1.0), ("M", 1.0), ("Comma", 1.0), ("Period", 1.0),
            ("Slash", 1.0), ("RShift", 2.75)]),
     (NAV_X, [(None, 1.0), ("Up", 1.0), (None, 1.0)]),
     (NUM_X, [("Num1", 1.0), ("Num2", 1.0), ("Num3", 1.0),
              ("NumEnter", 1.0, 2)])],

    # 第 5 排：底排 + ← ↓ → + 0(2u) .
    [(0.0, [("LCtrl", 1.25), ("LWin", 1.25), ("LAlt", 1.25), ("Space", 6.25),
            ("RAlt", 1.25), ("RWin", 1.25), ("Menu", 1.25), ("RCtrl", 1.25)]),
     (NAV_X, [("Left", 1.0), ("Down", 1.0), ("Right", 1.0)]),
     (NUM_X, [("Num0", 2.0), ("NumDot", 1.0)])],
]

# --- 60% 61 键（保留，用来对比/降级）-------------------------------
LAYOUT_60 = [
    [(0.0, [("Esc", 1.0), ("1", 1.0), ("2", 1.0), ("3", 1.0), ("4", 1.0),
            ("5", 1.0), ("6", 1.0), ("7", 1.0), ("8", 1.0), ("9", 1.0),
            ("0", 1.0), ("Minus", 1.0), ("Equal", 1.0), ("Backspace", 2.0)])],
    [(0.0, [("Tab", 1.5), ("Q", 1.0), ("W", 1.0), ("E", 1.0), ("R", 1.0),
            ("T", 1.0), ("Y", 1.0), ("U", 1.0), ("I", 1.0), ("O", 1.0),
            ("P", 1.0), ("LBracket", 1.0), ("RBracket", 1.0), ("Backslash", 1.5)])],
    [(0.0, [("CapsLock", 1.75), ("A", 1.0), ("S", 1.0), ("D", 1.0), ("F", 1.0),
            ("G", 1.0), ("H", 1.0), ("J", 1.0), ("K", 1.0), ("L", 1.0),
            ("Semicolon", 1.0), ("Quote", 1.0), ("Enter", 2.25)])],
    [(0.0, [("LShift", 2.25), ("Z", 1.0), ("X", 1.0), ("C", 1.0), ("V", 1.0),
            ("B", 1.0), ("N", 1.0), ("M", 1.0), ("Comma", 1.0), ("Period", 1.0),
            ("Slash", 1.0), ("RShift", 2.75)])],
    [(0.0, [("LCtrl", 1.25), ("LWin", 1.25), ("LAlt", 1.25), ("Space", 6.25),
            ("RAlt", 1.25), ("RWin", 1.25), ("Menu", 1.25), ("RCtrl", 1.25)])],
]

# ===== 用哪套布局，改这一行 =====
ACTIVE_LAYOUT = LAYOUT_FULL

# ---------------------------------------------------------------- #
# 配色分组：模型侧和贴图侧共用这一份，改颜色只改这里
# 取值按参考图 + 实物逐键核对过：
#   * 0 / - / = 是奶白，不是深巧
#   * F1 F2 深巧，F3~F8 奶白，F9~F12 深巧
#   * A S 奶白，D 往后才转深巧
#   * 小键盘只有顶部四颗深巧，数字键全奶白
#   * O P [ ; ' Enter . / Z X Shift 这几颗是奶白（实物确认）
#   * 数字排 3 和 4 是奶白，夹在 1 2 和 5~9 之间
# ---------------------------------------------------------------- #
CHOCO_KEYS = {
    "Esc", "Grave", "1", "2", "5", "6", "7", "8",
    "Backspace",
    "Q", "R", "T", "Y", "U", "I",
    "Backslash", "Tab",
    "D", "F", "G", "H", "J", "K", "L",
    "C", "V", "B", "N", "M", "Comma",
    "F1", "F2", "F9", "F10", "F11", "F12",
    "NumLock", "NumSlash", "NumAsterisk", "NumMinus", "NumPlus",
}
GREY_KEYS = {"PrtSc", "ScrLk", "Pause"}
ACCENT_KEYS = {"R": "blue", "I": "blue"}


def color_of(label):
    """键位 -> 配色分组名（cream / choco / grey / blue）。"""
    if label in ACCENT_KEYS:
        return ACCENT_KEYS[label]
    if label in CHOCO_KEYS:
        return "choco"
    if label in GREY_KEYS:
        return "grey"
    return "cream"


# ---------------------------------------------------------------- #
# 3. 纯 Python 的布局计算（不依赖 bpy，可以被单元测试）
# ---------------------------------------------------------------- #
def profile():
    """当前生效的键帽高度预设。"""
    return PROFILES[PROFILE]


def row_heights(n_rows):
    """返回 n_rows 排、从上到下的键帽高度。"""
    hs = profile()["heights"]
    if n_rows > len(hs):
        raise ValueError("排数超过 %d" % len(hs))
    return hs[-n_rows:]


def build_layout(layout=None, pitch=PITCH):
    """把布局表展开成每个键的 (x, y) 中心坐标。原点在键盘左下角，单位 mm。"""
    layout = layout or ACTIVE_LAYOUT
    n_rows = len(layout)
    keys = []
    for ri, row in enumerate(layout):
        for start_u, seg in row:
            x = start_u * pitch
            for item in seg:
                label, w = item[0], item[1]
                h = item[2] if len(item) > 2 else 1
                width = w * pitch
                if label is not None:          # None = 空位，不生成键
                    keys.append({
                        "label": label,
                        "row": ri,
                        "x": x + width / 2.0,
                        "y": (n_rows - ri - h / 2.0) * pitch,
                        "w": w,
                        "h": h,
                        "width_mm": width,
                        "depth_mm": h * pitch,
                        "accent": label in ACCENT_KEYS,
                        "zone": color_of(label),
                    })
                x += width
    return keys


def layout_size(layout=None, pitch=PITCH):
    """返回 (板宽, 板深)，单位 mm。"""
    layout = layout or ACTIVE_LAYOUT
    widest = 0.0
    for row in layout:
        for start_u, seg in row:
            end = start_u + sum(item[1] for item in seg)
            widest = max(widest, end)
    return widest * pitch, len(layout) * pitch


def check_layout(layout=None, pitch=PITCH):
    """返回问题列表：重叠、越界、洞。空列表 = 通过。"""
    layout = layout or ACTIVE_LAYOUT
    keys = build_layout(layout, pitch)
    problems = []

    # 1) 任意两键不得重叠（含 2u 高键）
    for i in range(len(keys)):
        a = keys[i]
        for j in range(i + 1, len(keys)):
            b = keys[j]
            ox = abs(a["x"] - b["x"]) * 2 - (a["width_mm"] + b["width_mm"])
            oy = abs(a["y"] - b["y"]) * 2 - (a["depth_mm"] + b["depth_mm"])
            if ox < -1e-6 and oy < -1e-6:
                problems.append("重叠: %s <-> %s" % (a["label"], b["label"]))

    # 2) 主区每一排都必须正好 15u
    for ri, row in enumerate(layout):
        main_w = sum(item[1] for start_u, seg in row if abs(start_u) < 1e-9
                     for item in seg)
        if main_w and abs(main_w - 15.0) > 1e-6:
            problems.append("第 %d 排主区宽度 %.3fu（应为 15u）" % (ri, main_w))

    # 3) 不能超出板面
    board_w, board_d = layout_size(layout, pitch)
    for k in keys:
        if (k["x"] - k["width_mm"] / 2 < -1e-6
                or k["x"] + k["width_mm"] / 2 > board_w + 1e-6
                or k["y"] - k["depth_mm"] / 2 < -1e-6
                or k["y"] + k["depth_mm"] / 2 > board_d + 1e-6):
            problems.append("越界: %s" % k["label"])
    return problems


# ---------------------------------------------------------------- #
# 4. Blender 部分
# ---------------------------------------------------------------- #
try:
    import bpy
    import bmesh
    from mathutils import Vector
except ImportError:      # 在纯 Python 里也能 import 本文件做布局测试
    bpy = None


def _recalc(mesh):
    """统一重算法线，手工建面最容易搞反的就是这个。"""
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


def _finish(obj, coll):
    coll.objects.link(obj)
    return obj


def make_mesh(name, verts, faces):
    if bpy is None:
        raise RuntimeError("需要 Blender 环境")
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    _recalc(me)
    return me


def make_box(name, size, center, coll):
    """用真尺寸建盒子（不用 ops 缩放，避免倒角宽度被非等比缩放破坏）。"""
    sx, sy, sz = (s / 2.0 for s in size)
    cx, cy, cz = center
    v = [(cx - sx, cy - sy, cz - sz), (cx + sx, cy - sy, cz - sz),
         (cx + sx, cy + sy, cz - sz), (cx - sx, cy + sy, cz - sz),
         (cx - sx, cy - sy, cz + sz), (cx + sx, cy - sy, cz + sz),
         (cx + sx, cy + sy, cz + sz), (cx - sx, cy + sy, cz + sz)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
         (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    obj = bpy.data.objects.new(name, make_mesh(name, v, f))
    return _finish(obj, coll)


def _smoothstep(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3.0 - 2.0 * t)


def _cat_disp(xn, yn, rw=1.0):
    """猫耳高度场（按实拍确认）。

    俯视轮廓仍是圆角方块，猫形只体现在高度上：
    后缘两侧隆起成耳、两耳之间下凹、边缘加权让顶面中心保持平滑。
    xn, yn 归一化到 ±1；rw 是径向权重（1=边缘，0=中心）。
    """
    back = _smoothstep(0.05, 0.90, yn)
    lobe = math.exp(-(((abs(xn) - EAR_POS) / EAR_WIDTH) ** 2))
    dip = math.exp(-((xn / DIP_WIDTH) ** 2))
    edge = _smoothstep(0.15, 0.92, rw)
    return (EAR_H * lobe - EAR_DIP * dip) * back * edge - DISH * min(
        1.0, xn * xn + yn * yn)


def _superellipse(a, b, t, n=None):
    n = SE_N if n is None else n
    c, s = math.cos(t), math.sin(t)
    return (a * math.copysign(abs(c) ** (2.0 / n), c),
            b * math.copysign(abs(s) ** (2.0 / n), s))


def make_keycap_mesh(name, w_mm, d_mm, h_mm, taper=None, ears=None):
    """圆角方块键帽 + 猫耳高度场。

    曲面从底部到顶部是连续的：直斜壁 -> 顶部圆角 -> 顶面。
    比例全部相对键帽尺寸推导，1u 和 6.25u 共享同一套参数也不会撑变形。
    """
    taper = profile()["taper"] if taper is None else taper
    ears = CAT_EARS if ears is None else ears
    bw, bd = w_mm - KEY_GAP, d_mm - KEY_GAP
    if ears:
        bw = min(bw * 1.02, w_mm - 0.15)      # 猫耳键帽实拍上略胖一点
        bd = min(bd * 1.02, d_mm - 0.15)

    # 圆角按较小边缩放，宽键不会被圆成胶囊
    scale = min(1.0, min(bw, bd) / (PITCH - KEY_GAP))
    r_top = R_TOP * scale
    r_bot = R_BOT * scale

    # 顶面收口半径（拔模之后）
    half_tx = bw / 2 - taper
    half_ty = bd / 2 - taper

    # 侧面是一条连续曲面，半径从底到顶单调不增：
    #   z=0 满宽 -> 底部圆角 -> 直斜壁 -> 顶部圆角 -> 顶面宽度
    z_wall_lo = r_bot
    z_wall_hi = h_mm - r_top
    half_bottom = (bw / 2, bd / 2)
    # 直壁起点就是满宽：底部圆角只在最下面一小段把边缘倒圆，
    # 截面宽度在 z=0 之后很快到达满宽，然后才开始收窄。
    half_at_wall_lo = (bw / 2, bd / 2)
    # 直壁终点 = 顶面宽度。顶部圆角只是把这最后一段"压圆"，
    # 不额外增加宽度 —— 否则整体会变成上宽下窄的倒锥，完全反了。
    half_at_wall_hi = (half_tx, half_ty)
    half_top = (half_tx, half_ty)

    def radius(z):
        """给定高度返回截面半宽。"""
        if z <= z_wall_lo:
            q = math.sqrt(max(0.0, r_bot ** 2 - (z_wall_lo - z) ** 2))
            k = (r_bot - q) / max(1e-6, r_bot)      # 0 -> 1
            return (half_bottom[0] + (half_at_wall_lo[0] - half_bottom[0]) * k,
                    half_bottom[1] + (half_at_wall_lo[1] - half_bottom[1]) * k)
        if z >= z_wall_hi:
            q = math.sqrt(max(0.0, r_top ** 2 - (z - z_wall_hi) ** 2))
            k = (r_top - q) / max(1e-6, r_top)      # 0 -> 1
            return (half_at_wall_hi[0] + (half_top[0] - half_at_wall_hi[0]) * k,
                    half_at_wall_hi[1] + (half_top[1] - half_at_wall_hi[1]) * k)
        t = (z - z_wall_lo) / max(1e-6, z_wall_hi - z_wall_lo)
        return (half_at_wall_lo[0]
                + (half_at_wall_hi[0] - half_at_wall_lo[0]) * t,
                half_at_wall_lo[1]
                + (half_at_wall_hi[1] - half_at_wall_lo[1]) * t)

    rings = []
    # --- 侧壁 + 顶部圆角 -------------------------------------------
    for k in range(SEG_K + 1):
        u = k / float(SEG_K)
        z = h_mm * u
        a, b = radius(z)
        g = _smoothstep(0.30, 1.0, u) if ears else 0.0
        rg = []
        for i in range(SEG_A):
            x, y = _superellipse(a, b, 2.0 * math.pi / SEG_A * i)
            dz = _cat_disp(x / half_tx, y / half_ty, 1.0) * g if ears else 0.0
            rg.append((x, y, z + dz))
        rings.append(rg)

    # --- 顶面：从边缘逐圈收到中心，半径用余弦分布让边缘更密 ---------
    # 之前 rr 从 1.0 直接跳到 0.75，留下一条没有细分的平面带，
    # 平面着色下就变成一圈"台阶"。这里改成等角度细分，边缘不跳变。
    for s in range(1, TOP_STEPS + 1):
        theta = 0.5 * math.pi * s / TOP_STEPS
        rr = math.cos(theta)
        rg = []
        for i in range(SEG_A):
            x, y = _superellipse(half_tx * rr, half_ty * rr,
                                 2.0 * math.pi / SEG_A * i)
            dz = _cat_disp(x / half_tx, y / half_ty, rr) if ears else 0.0
            # 顶面略微下凹，形成锅底
            rg.append((x, y, h_mm + dz - DISH * (1.0 - rr) ** 1.6))
        rings.append(rg)

    verts, faces = [], []
    for rg in rings:
        verts.extend(rg)
    nr = len(rings)
    for k in range(nr - 1):
        for i in range(SEG_A):
            j = (i + 1) % SEG_A
            faces.append((k * SEG_A + i, k * SEG_A + j,
                          (k + 1) * SEG_A + j, (k + 1) * SEG_A + i))
    top_i = (nr - 1) * SEG_A
    cz = sum(p[2] for p in rings[-1]) / SEG_A
    center = len(verts)
    verts.append((0.0, 0.0, cz))
    for i in range(SEG_A):
        faces.append((top_i + i, top_i + (i + 1) % SEG_A, center))
    base = len(verts)
    verts.append((0.0, 0.0, 0.0))
    for i in range(SEG_A):
        faces.append((base, (i + 1) % SEG_A, i))

    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    _recalc(me)
    # 平滑着色：这是"镜面碎裂感"的真正来源。
    # 平面着色会把每个三角面的法线单独断开，高光被切成一块块小镜片。
    for poly in me.polygons:
        poly.use_smooth = True
    me.update()
    me["cap_top_z"] = float(h_mm)
    return me


def assign_zone(obj, zone, material):
    """给零件打上"材质分区"标签 —— 这是贴图阶段不乱套的根本。"""
    obj["mat_zone"] = zone
    obj.data.materials.clear()
    obj.data.materials.append(material)
    return obj


def make_material(name, rgb, rough=0.5, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = metal
    return m


# ------------------------------------------------------------------ #
# 立体异形键：猫爪 / 猫头（凸起实体，不是贴图）
# ------------------------------------------------------------------ #
NOVELTY_KEYS = {"Esc": "paw", "Up": "paw", "Down": "paw",
                "Left": "paw", "Right": "paw", "NumPlus": "paw"}

PAW_METAL = (0.16, 0.13, 0.11)      # 深巧色肉垫
PAW_PINK = (0.86, 0.62, 0.60)       # 粉色肉垫


def _ellipsoid_mesh(name, r, center=(0, 0, 0), subdiv=3, lift=0.0):
    """生成一个平滑椭球，用来拼肉垫。subdiv=3 约 1280 面，够圆也不重。"""
    t = (1.0 + 5.0 ** 0.5) / 2.0
    verts = [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0),
             (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t),
             (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]
    faces = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11),
             (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
             (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9),
             (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]

    def norm(v):
        l = (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) ** 0.5
        return (v[0] / l, v[1] / l, v[2] / l)

    verts = [norm(v) for v in verts]
    for _ in range(subdiv):
        cache, nf = {}, []

        def mid(a, b):
            k = (min(a, b), max(a, b))
            if k not in cache:
                va, vb = verts[a], verts[b]
                verts.append(norm(((va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2,
                                   (va[2] + vb[2]) / 2)))
                cache[k] = len(verts) - 1
            return cache[k]

        for a, b, c in faces:
            ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
            nf += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]
        faces = nf

    verts = [(v[0] * r[0] + center[0], v[1] * r[1] + center[1],
              v[2] * r[2] + center[2] + lift) for v in verts]
    return make_mesh(name, verts, faces)


def add_paw(coll, material, origin, scale=1.0, top_z=0.0):
    """在 origin 处拼一只凸起的猫爪：1 个大肉垫 + 4 个趾垫。"""
    s = scale
    parts = [((2.85 * s, 2.20 * s, 0.62 * s), (0.0, -0.55 * s, 0.0), 0.0)]
    for tx, ty in ((-1.62, 1.95), (-0.56, 2.42), (0.56, 2.42), (1.62, 1.95)):
        parts.append(((1.02 * s, 0.94 * s, 0.52 * s), (tx * s, ty * s, 0.0), 0.06 * s))
    objs = []
    for i, (r, c, lift) in enumerate(parts):
        me = _ellipsoid_mesh("Paw_%d" % i, r, c, subdiv=2, lift=lift)
        ob = bpy.data.objects.new("Paw_%d" % i, me)
        ob.location = (origin[0], origin[1], origin[2] + top_z)
        coll.objects.link(ob)
        objs.append(assign_zone(ob, "novelty", material))
        ob.data.polygons.foreach_set("use_smooth", [True] * len(ob.data.polygons))
    return objs


def add_bevel(obj, width=BEVEL, segments=2):
    mod = obj.modifiers.new("Bevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(30)
    return mod


def main():
    # --- 场景单位：1 BU = 1mm -------------------------------------
    scn = bpy.context.scene
    scn.unit_settings.system = "METRIC"
    scn.unit_settings.scale_length = 0.001
    scn.unit_settings.length_unit = "MILLIMETERS"

    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)

    coll_case = bpy.data.collections.new("KBD_Case")
    coll_keys = bpy.data.collections.new("KBD_Keys")
    coll_proxy = bpy.data.collections.new("KBD_Proxies")
    for c in (coll_case, coll_keys, coll_proxy):
        scn.collection.children.link(c)

    # 外壳 = 和奶白键帽同色系的哑光塑料（比键帽略深一点，不然会糊成一片）
    mat_case = make_material("MAT_Case_Plastic", (0.72, 0.69, 0.64), 0.52)
    mat_key = make_material("MAT_Keycap_Glossy", (0.88, 0.85, 0.79), 0.20)
    mat_choco = make_material("MAT_Keycap_Choco", (0.20, 0.16, 0.13), 0.20)
    mat_accent = make_material("MAT_Keycap_Blue", (0.30, 0.50, 0.80), 0.20)
    mat_paw = make_material("MAT_Paw_Pad", (0.86, 0.62, 0.60), 0.18)

    board_w, board_d = layout_size()
    keys = build_layout()
    heights = row_heights(len(ACTIVE_LAYOUT))

    ox, oy = -board_w / 2.0, -board_d / 2.0

    # --- 底壳 + 四壁（不用布尔，避免 booleans 把网格搞脏）----------
    outer_w = board_w + 2 * CASE_BEZEL
    outer_d = board_d + 2 * CASE_BEZEL
    make_box("Case_Floor", (outer_w, outer_d, CASE_FLOOR_T),
             (0, 0, CASE_FLOOR_T / 2), coll_case)
    wall_h = CASE_H - CASE_FLOOR_T
    wall_cz = CASE_FLOOR_T + wall_h / 2
    make_box("Case_Wall_Front", (outer_w, CASE_WALL, wall_h),
             (0, -outer_d / 2 + CASE_WALL / 2, wall_cz), coll_case)
    make_box("Case_Wall_Back", (outer_w, CASE_WALL, wall_h),
             (0, outer_d / 2 - CASE_WALL / 2, wall_cz), coll_case)
    make_box("Case_Wall_Left", (CASE_WALL, outer_d - 2 * CASE_WALL, wall_h),
             (-outer_w / 2 + CASE_WALL / 2, 0, wall_cz), coll_case)
    make_box("Case_Wall_Right", (CASE_WALL, outer_d - 2 * CASE_WALL, wall_h),
             (outer_w / 2 - CASE_WALL / 2, 0, wall_cz), coll_case)
    for o in coll_case.objects:
        assign_zone(o, "case", mat_case)
        add_bevel(o, 0.8, 2)
        o["note"] = "AI 不要碰这里的尺寸"

    # --- 定位板 ---------------------------------------------------
    # 定位板夹在外壳顶面以下：外壳总高 CASE_H 已经包含它，不能再往上叠一层，
    # 否则键帽会整体浮空 1.5mm（渲染时表现为键帽悬在外壳上方）。
    plate_z = CASE_H - PLATE_T
    plate = make_box("Plate", (board_w + 2, board_d + 2, PLATE_T),
                     (0, 0, plate_z + PLATE_T / 2), coll_case)
    assign_zone(plate, "plate", mat_case)

    # 键帽坐在外壳顶面
    cap_top_z = CASE_H

    # --- 轴座示意 ---------------------------------------------------
    # 只在需要时生成：104 个独立轴座会白占 104 个 drawcall，网页里根本看不见。
    if BUILD_SWITCHES:
        d = STEM_D / 2
        v = [(-d, -d, 0), (d, -d, 0), (d, d, 0), (-d, d, 0),
             (-d, -d, 4), (d, -d, 4), (d, d, 4), (-d, d, 4)]
        f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
             (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        stem_me = bpy.data.meshes.new("SwitchStem")   # 104 个物体共享这一份
        stem_me.from_pydata(v, [], f)
        _recalc(stem_me)
        for k in keys:
            ob = bpy.data.objects.new("Switch_" + k["label"], stem_me)
            ob.location = (k["x"] + ox, k["y"] + oy, cap_top_z)
            assign_zone(_finish(ob, coll_proxy), "switch", mat_case)

    # --- 键帽：同尺寸共享网格数据（真实的"实例化"，省显存也省 UV）--
    cache = {}
    top_z = cap_top_z
    mat_by_color = {"cream": mat_key, "choco": mat_choco,
                    "grey": mat_key, "blue": mat_accent}
    paw_count = 0
    for k in keys:
        h = heights[min(k["row"], len(heights) - 1)]
        zone = color_of(k["label"])
        # 缓存键只用尺寸：MAO 各排高度差只有 0.6mm，视觉上看不出，
        # 但按 (尺寸, 行高) 分组会把网格拆成 22 份，白白增加 drawcall。
        ck = (round(k["width_mm"], 3), round(k["depth_mm"], 3))
        if ck not in cache:
            cache[ck] = make_keycap_mesh(
                "KeycapMesh_%d" % len(cache), k["width_mm"], k["depth_mm"], h)
        ob = bpy.data.objects.new("%s_r%d_%s" % (k["label"], k["row"], zone),
                                  cache[ck])
        cx, cy = k["x"] + ox, k["y"] + oy
        ob.location = (cx, cy, top_z)
        _finish(ob, coll_keys)
        assign_zone(ob, zone, mat_by_color[zone])

        # 猫耳已经烘在共享网格里，这里不需要额外几何

    # --- 相机 + 灯，方便立刻 F12 看一眼比例 ----------------------
    cam_data = bpy.data.cameras.new("Cam")
    cam_data.lens = 85
    cam = bpy.data.objects.new("Cam", cam_data)
    cam.location = (outer_w * 0.75, -outer_d * 2.2, 300.0)
    target = Vector((0, 0, 20))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    scn.collection.objects.link(cam)
    scn.camera = cam

    sun_data = bpy.data.lights.new("Sun", "SUN")
    sun_data.energy = 4.0
    sun = bpy.data.objects.new("Sun", sun_data)
    sun.rotation_euler = (math.radians(50), math.radians(8), math.radians(35))
    scn.collection.objects.link(sun)

    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.05, 0.06, 1)
    scn.world = world

    print("[OK] 布局检查:", check_layout() or "无重叠 / 每排 15u / 无越界")
    print("[OK] 板面尺寸: %.2f x %.2f mm  外壳: %.2f x %.2f mm"
          % (board_w, board_d, outer_w, outer_d))
    print("[OK] 键数: %d  唯一键帽网格: %d  猫耳键帽: %s"
          % (len(keys), len(cache), "全部 %d 颗" % len(keys) if CAT_EARS else "关闭"))


def export_glb(path):
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_apply=True,            # 把倒角/平滑烘焙进导出结果
        export_yup=True,
        use_selection=False,
    )


if __name__ == "__main__" and bpy is not None:
    main()
