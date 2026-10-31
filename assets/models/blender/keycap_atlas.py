# -*- coding: utf-8 -*-
"""
keycap_atlas.py - 生成键帽图集（albedo + 图例 UV 表）
=====================================================
AI 永远画不对键帽字符，所以字符这层用真实字体排版后烘焙进一张图集。

输入：keyboard_blockout.py 里的 LAYOUT_FULL（唯一尺寸真相）
输出：
  out/keycap_atlas.png         sRGB albedo 图集
  out/keycap_atlas_preview.png 缩小预览
  out/keycap_legend_uv.json    每个键的图集 UV 矩形 + 颜色分组
  out/keycap_roughness.png     粗糙度灰度图（亮面键帽 = 低粗糙度）

用法：
  python keycap_atlas.py                # 默认 128 px/u
  python keycap_atlas.py --u-px 192     # 更清晰
  python keycap_atlas.py --u-px 96      # 更省
"""

from __future__ import annotations
import argparse, json, os, sys
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from keyboard_blockout import (  # noqa: E402
    LAYOUT_FULL, PITCH, build_layout, layout_size,
    CHOCO_KEYS, GREY_KEYS, ACCENT_KEYS, color_of,
)

# ------------------------------------------------------------------ #
# 1. 配色（从参考图取的近似值，想改就改这里）
# ------------------------------------------------------------------ #
PALETTE = {
    "choco":   (74, 63, 53),      # 深巧 #4A3F35
    "cream":   (240, 233, 222),   # 奶白 #F0E9DE
    "grey":    (228, 224, 216),   # 浅灰 #E4E0D8
    "blue":    (91, 143, 217),    # 撞色蓝 #5B8FD9
    "legend_light": (232, 224, 212),
    "legend_dark":  (58, 50, 43),
}

# 配色分组定义在 keyboard_blockout.py（模型侧和贴图侧共用一份），此处只引用。

# 不做肉垫印花，104 颗键全部印字符（和参考图主键区一致）
NOVELTY_KEYS = set()


def legend_color(bg):
    """字符颜色必须跟着底色走，保证对比度。

    choco 深巧底 -> 奶白字
    blue  蓝底   -> 奶白字（之前错用了深棕，对比度只有 1.9:1，几乎看不见）
    cream/grey   -> 深巧字
    """
    if bg in ("choco", "blue"):
        return PALETTE["legend_light"]
    return PALETTE["legend_dark"]


# ------------------------------------------------------------------ #
# 2. 字符表：单字符 或 (上档符号, 主字符) 双行排布
# ------------------------------------------------------------------ #
LEGENDS = {
    "Grave": ("~", "\x60"), "Minus": ("_", "-"), "Equal": ("+", "="),
    "LBracket": ("{", "["), "RBracket": ("}", "]"), "Backslash": ("|", "\x5c"),
    "Semicolon": (":", ";"), "Quote": ('"', "'"),
    "Comma": ("<", ","), "Period": (">", "."), "Slash": ("?", "/"),
    "1": ("!", "1"), "2": ("@", "2"), "3": ("#", "3"), "4": ("$", "4"),
    "5": ("%", "5"), "6": ("^", "6"), "7": ("&", "7"), "8": ("*", "8"),
    "9": ("(", "9"), "0": (")", "0"),

    "Esc": "Esc", "Backspace": "Backspace", "Tab": "Tab",
    "CapsLock": "Caps Lock", "Enter": "Enter",
    "LShift": "Shift", "RShift": "Shift",
    "LCtrl": "Ctrl", "RCtrl": "Ctrl",
    "LWin": "Super", "RWin": "Super",
    "LAlt": "Alt", "RAlt": "Alt", "Menu": "Menu",
    "Space": "",

    "PrtSc": "PrtSc", "ScrLk": "ScrLk", "Pause": "Pause",
    "Insert": "Ins", "Delete": "Del", "Home": "Home", "End": "End",
    "PageUp": "PgUp", "PageDown": "PgDn",

    "NumLock": "Num", "NumSlash": "/", "NumAsterisk": "*",
    "NumMinus": "-", "NumPlus": "+", "NumEnter": "Enter", "NumDot": ".",
}
for _i in range(1, 13):
    LEGENDS.setdefault("F%d" % _i, "F%d" % _i)
for _i in range(10):
    LEGENDS.setdefault("Num%d" % _i, str(_i))
for _c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
    LEGENDS.setdefault(_c, _c)


def legend_of(label):
    if label in NOVELTY_KEYS:
        return ""        # 立体异形键，表面不印字
    return LEGENDS.get(label, label)


# ------------------------------------------------------------------ #
# 3. 字体
# ------------------------------------------------------------------ #
# 参考图是圆角粗体，Arial Rounded Bold 是最接近的现成字体。
# 想换成参考图原版字体：把 ttf 路径放到第一位即可。
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\ARLRDBD.TTF",   # Arial Rounded Bold  <- 匹配参考图
    r"C:\Windows\Fonts\seguisb.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
]
_MEASURE = ImageDraw.Draw(Image.new("L", (1, 1)))


def load_font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                continue
    return ImageFont.load_default()


def fit_font(text, max_w, max_h, cap):
    """二分找最大的字号，让文字塞进框里。"""
    lo, hi, best = 8, max(cap, 8), load_font(8)
    while lo <= hi:
        mid = (lo + hi) // 2
        f = load_font(mid)
        l, t, r, b = _MEASURE.textbbox((0, 0), text, font=f)
        if (r - l) <= max_w and (b - t) <= max_h:
            best, lo = f, mid + 1
        else:
            hi = mid - 1
    return best


def draw_legend(draw, box, label, fg, u_px):
    """box = 键帽顶面在图集里的像素矩形 (x0, y0, x1, y1)。"""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    txt = legend_of(label)
    if not txt:
        return
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2

    if isinstance(txt, tuple):
        top, main = txt
        f_top = fit_font(top, int(w * 0.50), int(h * 0.30), int(u_px * 0.46))
        f_main = fit_font(main, int(w * 0.66), int(h * 0.46), int(u_px * 0.74))
        for f, t, dy in ((f_top, top, -h * 0.21), (f_main, main, h * 0.11)):
            l, t2, r, b = draw.textbbox((0, 0), t, font=f)
            draw.text((cx - (l + r) / 2, cy + dy - (t2 + b) / 2), t, font=f, fill=fg)
    else:
        f = fit_font(txt, int(w * 0.78), int(h * 0.52), int(u_px * 0.80))
        l, t2, r, b = draw.textbbox((0, 0), txt, font=f)
        draw.text((cx - (l + r) / 2, cy - (t2 + b) / 2), txt, font=f, fill=fg)


# ------------------------------------------------------------------ #
# 4. 图集排版：把布局表映射到网格格子
# ------------------------------------------------------------------ #
COLS, ROWS = 23, 6


def cells_px(u_px, pad_ratio=0.06):
    """直接用真实几何坐标排版（不用整数网格 —— F 区和小键盘本身就落在
    半 u 位置上，吸整会互相覆盖）。返回 [(label, box_px, w_u, h_u), ...]。"""
    keys = build_layout(LAYOUT_FULL)
    s = u_px / float(PITCH)
    board_w, board_d = layout_size(LAYOUT_FULL)
    pad = max(1, int(u_px * pad_ratio))
    out = []
    for k in keys:
        x0 = (k["x"] - k["width_mm"] / 2.0) * s
        x1 = (k["x"] + k["width_mm"] / 2.0) * s
        # 图集 y 轴向下，布局 y 轴向上
        y0 = (board_d - (k["y"] + k["depth_mm"] / 2.0)) * s
        y1 = (board_d - (k["y"] - k["depth_mm"] / 2.0)) * s
        box = (x0 + pad, y0 + pad, x1 - pad, y1 - pad)
        out.append((k["label"], box, k["w"], k["h"]))
    return out, board_w, board_d


def build(u_px=128, outdir="out", dish=0.10):
    cells, board_w, board_d = cells_px(u_px)
    W = int(round(board_w * u_px / float(PITCH)))
    H = int(round(board_d * u_px / float(PITCH)))
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    rough = Image.new("L", (W, H), 0)
    rd = ImageDraw.Draw(rough)

    for label, box, w_u, h_u in cells:
        bg = color_of(label)
        r = int(u_px * 0.15)
        draw.rounded_rectangle(box, radius=r, fill=PALETTE[bg])
        rd.rounded_rectangle(box, radius=r, fill=45)   # 亮面: rough ~= 0.18
        draw_legend(draw, box, label, legend_color(bg), u_px)

    # 微弱中心提亮，模拟球帽顶面微凹（只影响预览观感，不影响 UV）
    if dish > 0:
        from PIL import ImageFilter
        hi = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        hd = ImageDraw.Draw(hi)
        for label, box, w_u, h_u in cells:
            cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
            rx, ry = (box[2] - box[0]) * 0.42, (box[3] - box[1]) * 0.42
            hd.ellipse([cx - rx, cy - ry, cx + rx, cy + ry],
                       fill=(255, 255, 255, int(255 * dish)))
        hi = hi.filter(ImageFilter.GaussianBlur(u_px * 0.08))
        mask = img.split()[3]
        img = Image.composite(Image.alpha_composite(img, hi), img, mask)

    uv = {}
    for label, box, w_u, h_u in cells:
        uv[label] = {
            "rect": [round(box[0] / W, 6), round(box[1] / H, 6),
                     round(box[2] / W, 6), round(box[3] / H, 6)],
            "color": color_of(label),
            "size_u": [round(w_u, 3), round(h_u, 3)],
        }

    os.makedirs(outdir, exist_ok=True)
    atlas = os.path.join(outdir, "keycap_atlas.png")
    img.convert("RGB").save(atlas, optimize=True)
    rough.save(os.path.join(outdir, "keycap_roughness.png"))
    with open(os.path.join(outdir, "keycap_legend_uv.json"), "w", encoding="utf-8") as f:
        json.dump({"atlas_px": [W, H], "u_px": u_px, "keys": uv},
                  f, ensure_ascii=False, indent=1)

    prev = img.convert("RGB")
    prev.thumbnail((1500, 1500), Image.LANCZOS)
    prev.save(os.path.join(outdir, "keycap_atlas_preview.png"))

    print("[OK] atlas %dx%d  keys=%d  %.0f KB" %
          (W, H, len(cells), os.path.getsize(atlas) / 1024))
    print("[OK] ->", os.path.abspath(atlas))
    return atlas


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--u-px", type=int, default=128)
    ap.add_argument("--out", default="out")
    ap.add_argument("--dish", type=float, default=0.10)
    a = ap.parse_args()
    build(a.u_px, a.out, a.dish)
