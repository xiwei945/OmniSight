# -*- coding: utf-8 -*-
"""relayout_keyboard_cat.py —— 按标准 ANSI 104 重排猫耳键盘的键帽坐标
=====================================================================

`keyboard.glb` 的键帽是「一键一节点 + 平移」烘出来的（网格按 1u/2u/2.25u… 各自建好，
节点只负责摆位），所以修布局**不需要 Blender**：改 `translation` 就够了，网格、UV、
图集、材质、猫耳形状一个字节都不动。

修的是三处（2026-10-29 用户看图指出）：

1. F 区左端的空档。生成器里写成 `(None, 1.5)`，标准是 1u —— 导致 F1~F4 整体右移
   半格，F1 压在了 2/3 之间而不是 2 的正上方。
2. F 区组间距。生成器里写成 `(None, 0.25)`，标准是 0.5u —— 四键一组的视觉分组散掉了。
3. 小键盘整体高了一排。生成器把小键盘的 NumLock 行放在第 0 排（和 F 区同一排），
   结果小键盘最后一行只到第 4 排，底排右侧空出 4u x 1u 的一块死板。

坐标换算（和生成器一致）：
    glb_x = x_mm - BOARD_W/2
    glb_z = BOARD_D/2 - y_mm          # 布局表的 y 从下往上量，glTF 的 +z 朝下
    y 保持 18mm（外壳高），所有键帽共面

用法：
    python tools/relayout_keyboard_cat.py --check     # 只报告偏差，不写文件
    python tools/relayout_keyboard_cat.py --apply     # 备份后写回
"""

from __future__ import annotations

import argparse
import json
import shutil
import struct
import sys
from pathlib import Path

PITCH = 19.05  # 1u 键距(mm)，键盘界的物理常数

MAIN_U = 15.0
BLOCK_GAP_U = 0.25
NAV_U = 3.0
NUM_U = 4.0
NAV_X = MAIN_U + BLOCK_GAP_U          # 15.25
NUM_X = NAV_X + NAV_U + BLOCK_GAP_U   # 18.50
BOARD_W = (NUM_X + NUM_U) * PITCH     # 428.625 mm
BOARD_D = 6 * PITCH                   # 114.300 mm

# 键帽落座的平面高度(mm)，取自导出的 GLB（所有节点 y 都是 18）
KEY_Y = 18.0

# ---------------------------------------------------------------- #
# 布局表：格式同 keyboard_blockout.LAYOUT_FULL
#   每一排 = [(起始 u, [(标签, 宽u[, 高u]), ...]), ...]
#   None 表示空位（间距），不生成键；高u 默认 1
# ---------------------------------------------------------------- #
LAYOUT = [
    # 第 0 排：F 区（Esc 后留 1u，四键一组间隔 0.5u）+ 导航上排；小键盘这排是空的
    [
        (0.0, [
            ("Esc", 1.0), (None, 1.0),
            ("F1", 1.0), ("F2", 1.0), ("F3", 1.0), ("F4", 1.0), (None, 0.5),
            ("F5", 1.0), ("F6", 1.0), ("F7", 1.0), ("F8", 1.0), (None, 0.5),
            ("F9", 1.0), ("F10", 1.0), ("F11", 1.0), ("F12", 1.0),
        ]),
        (NAV_X, [("PrtSc", 1.0), ("ScrLk", 1.0), ("Pause", 1.0)]),
    ],
    # 第 1 排：数字排 + Ins/Home/PgUp + 小键盘 NumLock 行
    [
        (0.0, [
            ("Grave", 1.0), ("1", 1.0), ("2", 1.0), ("3", 1.0), ("4", 1.0),
            ("5", 1.0), ("6", 1.0), ("7", 1.0), ("8", 1.0), ("9", 1.0),
            ("0", 1.0), ("Minus", 1.0), ("Equal", 1.0), ("Backspace", 2.0),
        ]),
        (NAV_X, [("Insert", 1.0), ("Home", 1.0), ("PageUp", 1.0)]),
        (NUM_X, [("NumLock", 1.0), ("NumSlash", 1.0),
                 ("NumAsterisk", 1.0), ("NumMinus", 1.0)]),
    ],
    # 第 2 排：Tab 排 + Del/End/PgDn + 7 8 9 +
    [
        (0.0, [
            ("Tab", 1.5), ("Q", 1.0), ("W", 1.0), ("E", 1.0), ("R", 1.0),
            ("T", 1.0), ("Y", 1.0), ("U", 1.0), ("I", 1.0), ("O", 1.0),
            ("P", 1.0), ("LBracket", 1.0), ("RBracket", 1.0), ("Backslash", 1.5),
        ]),
        (NAV_X, [("Delete", 1.0), ("End", 1.0), ("PageDown", 1.0)]),
        (NUM_X, [("Num7", 1.0), ("Num8", 1.0), ("Num9", 1.0), ("NumPlus", 1.0, 2)]),
    ],
    # 第 3 排：Caps 排 + 4 5 6（+ 键跨这两排的右列）
    [
        (0.0, [
            ("CapsLock", 1.75), ("A", 1.0), ("S", 1.0), ("D", 1.0), ("F", 1.0),
            ("G", 1.0), ("H", 1.0), ("J", 1.0), ("K", 1.0), ("L", 1.0),
            ("Semicolon", 1.0), ("Quote", 1.0), ("Enter", 2.25),
        ]),
        (NUM_X, [("Num4", 1.0), ("Num5", 1.0), ("Num6", 1.0)]),
    ],
    # 第 4 排：Shift 排 + ↑ + 1 2 3 Enter(2u 高，跨底排)
    [
        (0.0, [
            ("LShift", 2.25), ("Z", 1.0), ("X", 1.0), ("C", 1.0), ("V", 1.0),
            ("B", 1.0), ("N", 1.0), ("M", 1.0), ("Comma", 1.0), ("Period", 1.0),
            ("Slash", 1.0), ("RShift", 2.75),
        ]),
        (NAV_X, [(None, 1.0), ("Up", 1.0), (None, 1.0)]),
        (NUM_X, [("Num1", 1.0), ("Num2", 1.0), ("Num3", 1.0), ("NumEnter", 1.0, 2)]),
    ],
    # 第 5 排：底排 + ← ↓ → + 0(2u) .
    [
        (0.0, [
            ("LCtrl", 1.25), ("LWin", 1.25), ("LAlt", 1.25), ("Space", 6.25),
            ("RAlt", 1.25), ("RWin", 1.25), ("Menu", 1.25), ("RCtrl", 1.25),
        ]),
        (NAV_X, [("Left", 1.0), ("Down", 1.0), ("Right", 1.0)]),
        (NUM_X, [("Num0", 2.0), ("NumDot", 1.0)]),
    ],
]


def build_keys():
    """展开布局表 -> [{label, row, u, x_mm, y_mm, w, h}]，坐标原点在板左脚。"""
    n_rows = len(LAYOUT)
    keys: list[dict] = []
    for ri, row in enumerate(LAYOUT):
        for start_u, seg in row:
            u = start_u
            for item in seg:
                label, w = item[0], item[1]
                h = item[2] if len(item) > 2 else 1.0
                if label is not None:
                    keys.append({
                        "label": label,
                        "row": ri,
                        "u": u,
                        "x_mm": (u + w / 2.0) * PITCH,
                        "y_mm": (n_rows - ri - h / 2.0) * PITCH,
                        "w": w,
                        "h": h,
                    })
                u += w
    return keys


def check_keys(keys):
    """重叠 / 越界 / 主区宽度自检。返回问题列表，空 = 通过。"""
    problems = []
    for a_i in range(len(keys)):
        a = keys[a_i]
        for b_i in range(a_i + 1, len(keys)):
            b = keys[b_i]
            if abs(a["x_mm"] - b["x_mm"]) < (a["w"] + b["w"]) / 2.0 * PITCH - 1e-6 and \
               abs(a["y_mm"] - b["y_mm"]) < (a["h"] + b["h"]) / 2.0 * PITCH - 1e-6:
                problems.append("重叠: %s <-> %s" % (a["label"], b["label"]))
    for ri, row in enumerate(LAYOUT):
        main_w = sum(item[1] for start_u, seg in row if abs(start_u) < 1e-9 for item in seg)
        if main_w and abs(main_w - MAIN_U) > 1e-6:
            problems.append("第 %d 排主区 %.3fu（应为 15u）" % (ri, main_w))
    for k in keys:
        x0 = k["x_mm"] - k["w"] / 2.0 * PITCH
        x1 = k["x_mm"] + k["w"] / 2.0 * PITCH
        y0 = k["y_mm"] - k["h"] / 2.0 * PITCH
        y1 = k["y_mm"] + k["h"] / 2.0 * PITCH
        if x0 < -1e-6 or x1 > BOARD_W + 1e-6 or y0 < -1e-6 or y1 > BOARD_D + 1e-6:
            problems.append("越界: %s" % k["label"])
    return problems


def target_translation(key):
    """布局坐标 -> GLB 节点平移。"""
    return (
        round(key["x_mm"] - BOARD_W / 2.0, 6),
        KEY_Y,
        round(BOARD_D / 2.0 - key["y_mm"], 6),
    )


# ---------------------------------------------------------------- #
# GLB 读写（只碰 JSON chunk，BIN chunk 原样搬）
# ---------------------------------------------------------------- #
def read_glb(path: Path):
    raw = path.read_bytes()
    magic, version, total = struct.unpack_from("<III", raw, 0)
    if magic != 0x46546C67:
        raise SystemExit("不是 GLB: %s" % path)
    offset = 12
    gltf = None
    binary = b""
    while offset < total:
        length, kind = struct.unpack_from("<II", raw, offset)
        payload = raw[offset + 8: offset + 8 + length]
        if kind == 0x4E4F534A:      # JSON
            gltf = json.loads(payload.decode("utf-8"))
        elif kind == 0x004E4942:    # BIN
            binary = payload
        offset += 8 + length
    if gltf is None:
        raise SystemExit("GLB 里没有 JSON chunk")
    return gltf, binary


def write_glb(path: Path, gltf, binary: bytes):
    blob = json.dumps(gltf, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    blob += b" " * ((4 - len(blob) % 4) % 4)        # JSON 用空格补齐
    binary += b"\x00" * ((4 - len(binary) % 4) % 4)  # BIN 用 0 补齐
    total = 12 + 8 + len(blob) + (8 + len(binary) if binary else 0)
    out = bytearray()
    out += struct.pack("<III", 0x46546C67, 2, total)
    out += struct.pack("<II", len(blob), 0x4E4F534A)
    out += blob
    if binary:
        out += struct.pack("<II", len(binary), 0x004E4942)
        out += binary
    path.write_bytes(bytes(out))


def label_of(node_name: str) -> str | None:
    """`LShift_r4_cream` -> `LShift`（和 keyboard-cat.ts 的 SUFFIX 同源规则）。"""
    head, sep, tail = node_name.rpartition("_r")
    if not sep or not head:
        return None
    row, _, zone = tail.partition("_")
    if not row.isdigit() or zone not in ("cream", "choco", "grey", "blue"):
        return None
    return head


def main() -> int:
    here = Path(__file__).resolve().parent.parent
    default_glb = here / "src/omnisight/presentation/static/assets/keyboard.glb"

    ap = argparse.ArgumentParser(description="按标准 ANSI 104 重排键盘键帽坐标")
    ap.add_argument("--glb", type=Path, default=default_glb)
    ap.add_argument("--check", action="store_true", help="只报告偏差")
    ap.add_argument("--apply", action="store_true", help="备份后写回")
    ap.add_argument("--prune", action="store_true",
                    help="同时把 assets/models/keyboard-cat.glb 一起更新")
    args = ap.parse_args()

    keys = build_keys()
    problems = check_keys(keys)
    if problems:
        print("[FAIL] 布局表自检未通过：")
        for p in problems:
            print("   -", p)
        return 1
    print("[OK] 布局表自检通过：%d 键 / 主区每排 15u / 板面 %.2f x %.2f mm"
          % (len(keys), BOARD_W, BOARD_D))

    gltf, binary = read_glb(args.glb)
    by_label = {k["label"]: k for k in keys}
    changed = []
    unknown = []
    for node in gltf["nodes"]:
        label = label_of(node.get("name", ""))
        if label is None:
            continue
        key = by_label.get(label)
        if key is None:
            unknown.append(node["name"])
            continue
        want = list(target_translation(key))
        have = list(node.get("translation", [0.0, 0.0, 0.0]))
        delta = max(abs(a - b) for a, b in zip(have, want))
        if delta > 1e-4:
            changed.append((node["name"], have, want, delta))
        node["translation"] = want

    print("[INFO] 键帽节点命中 %d 个，需要移动 %d 个" % (len(keys) - len(unknown), len(changed)))
    if unknown:
        print("[WARN] 布局表里没有这些节点（保持原位）：%s" % ", ".join(unknown))
    for name, have, want, delta in changed:
        print("   %-22s x %8.3f -> %8.3f   z %8.3f -> %8.3f   |d|=%.3fmm"
              % (name, have[0], want[0], have[2], want[2], delta))

    if not changed:
        print("[OK] 已经是标准布局，无需改动")
        return 0
    if not args.apply:
        print("[DRY] 未写文件。确认无误后加 --apply")
        return 0

    stamp = args.glb.stat().st_mtime
    backup = args.glb.with_name(args.glb.stem + ".before-relayout-%d.glb" % int(stamp))
    shutil.copy2(args.glb, backup)
    print("[OK] 备份 -> %s" % backup)
    write_glb(args.glb, gltf, binary)
    print("[OK] 写回 -> %s (%d KB)" % (args.glb, args.glb.stat().st_size // 1024))

    if args.prune:
        twin = here / "assets/models/keyboard-cat.glb"
        if twin.exists():
            shutil.copy2(args.glb, twin)
            print("[OK] 同步 -> %s" % twin)
    return 0


if __name__ == "__main__":
    # 中文输出在 cp1252/cp936 管道里会 UnicodeEncodeError（见 tools/_console.py）
    from _console import use_utf8_output

    use_utf8_output()
    sys.exit(main())
