# -*- coding: utf-8 -*-
"""dress_keyboard_case.py —— 给键盘补上盖 + 压深定位板
=======================================================

## 为什么

模型里外壳顶面、定位板（`Plate`）顶面、键帽底面**三者都在 `y = 18`**：

    Case_Wall_*    y 3 .. 18      外壳壁顶面 = 定位板面
    Plate          y 16.5 .. 18
    键帽            y 18 .. 30.5   （露出 12.5mm）

于是整块键盘是一只**敞开的浅盘**：键帽摆在盘底上，四周是一整片同色的白，没有厚度可依。
两个后果——看着"凹陷"；键帽上下动的时候旁边没有静止的东西，起伏只能靠"变大变小"读。

这里做两件事（都只动外壳，键帽的网格 / UV / 图集 / 猫耳一个字不碰）：

1. **补上盖** `Case_Top`：七块长方体拼成一块开三个洞的面板，坐在外壳壁顶上，
   顶面 `y = 22`（比定位板高 4mm）。键帽从洞里露出来，露出约 8.5mm。
2. **压深定位板**：新材质 `MAT_Plate`（比外壳深一档的暖灰）贴到 `Plate` 上。
   缝里是暗的，键位区才会从外壳里"浮"出来；不然缝是白的，有没有台阶都一样。

开洞尺度（mm，glTF 坐标：y 向上，+z 朝前）：

    外轮廓   x ±222.31  z ±65.15     （与 Case_Floor 外沿齐平）
    主区    x -214.31 ..  71.44   z -57.15 .. 57.15
    导航区  x   76.20 .. 133.35   z -57.15 .. 57.15
    小键盘  x  138.11 .. 214.31   z -38.10 .. 57.15
    小键盘上方（第 0 排右端）是**实心的**——全尺寸键盘那里本来就是外壳。

两个步骤都是幂等的：已经有 `Case_Top` / `MAT_Plate` 就跳过那一步。

用法：
    python tools/dress_keyboard_case.py --check
    python tools/dress_keyboard_case.py --apply --prune --top 22
"""

from __future__ import annotations

import argparse
import json
import shutil
import struct
import sys
from pathlib import Path

PITCH = 19.05
HALF_W = 22.5 * PITCH / 2.0        # 214.3125
HALF_D = 6 * PITCH / 2.0           # 57.15
BEZEL = 8.0
CASE_HALF_W = HALF_W + BEZEL       # 222.3125（= Case_Floor 的 ±222.31）
CASE_HALF_D = HALF_D + BEZEL       # 65.15

FRAME_BOTTOM = 18.0                # 坐在外壳壁顶面
FRAME_TOP = 22.0                   # 4mm 台阶

MAIN_X1 = 15.0 * PITCH - HALF_W    # 71.4375
NAV_X0 = 15.25 * PITCH - HALF_W    # 76.20
NAV_X1 = 18.25 * PITCH - HALF_W    # 133.35
NUM_X0 = 18.5 * PITCH - HALF_W     # 138.1125
NUM_Z0 = -38.10                    # 小键盘顶上那排的起点（第 1 排后沿）

# 定位板颜色：线性空间的暖灰（≈ sRGB #b3a695）。比外壳深一档，但仍在"奶油拿铁"里。
PLATE_COLOR = [0.42, 0.37, 0.31, 1.0]
# 上盖颜色：比外壳浅一档的奶白（≈ sRGB #f0eae0）。同色的话台级读不出来——
# 三层要三种色阶：上盖最浅、外壳中间、定位板最深。
FRAME_COLOR = [0.80, 0.76, 0.70, 1.0]


def case_top_material(gltf) -> int:
    """上盖专用材质：比外壳浅一档，让"这一层"在平光下也分得出来。"""
    materials = gltf.setdefault("materials", [])
    index = next((i for i, item in enumerate(materials) if item.get("name") == "MAT_Case_Top"), None)
    if index is None:
        materials.append({
            "name": "MAT_Case_Top",
            "pbrMetallicRoughness": {
                "baseColorFactor": FRAME_COLOR,
                "metallicFactor": 0,
                "roughnessFactor": 0.5,
            },
        })
        index = len(materials) - 1
    return index


def panels() -> list[tuple[float, float, float, float, float, float]]:
    """上盖的面板：(x0, x1, y0, y1, z0, z1)，七块拼成"开三个洞的板"。"""
    y0, y1 = FRAME_BOTTOM, FRAME_TOP
    return [
        (-CASE_HALF_W, CASE_HALF_W, y0, y1, -CASE_HALF_D, -HALF_D),   # 后沿
        (-CASE_HALF_W, CASE_HALF_W, y0, y1, HALF_D, CASE_HALF_D),     # 前沿
        (-CASE_HALF_W, -HALF_W, y0, y1, -HALF_D, HALF_D),             # 左侧
        (HALF_W, CASE_HALF_W, y0, y1, -HALF_D, HALF_D),               # 右侧
        (MAIN_X1, NAV_X0, y0, y1, -HALF_D, HALF_D),                   # 隔条 1
        (NAV_X1, NUM_X0, y0, y1, -HALF_D, HALF_D),                    # 隔条 2
        (NUM_X0, HALF_W, y0, y1, -HALF_D, NUM_Z0),                    # 小键盘上方实心
    ]


# 每个面：4 个角（归一化到 0/1）+ 法线，顺序保证从外面看逆时针
FACES = [
    ((0, 0, 1), [(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)]),
    ((0, 0, -1), [(1, 0, 0), (0, 0, 0), (0, 1, 0), (1, 1, 0)]),
    ((1, 0, 0), [(1, 0, 1), (1, 0, 0), (1, 1, 0), (1, 1, 1)]),
    ((-1, 0, 0), [(0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)]),
    ((0, 1, 0), [(0, 1, 1), (1, 1, 1), (1, 1, 0), (0, 1, 0)]),
    ((0, -1, 0), [(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)]),
]


def build_mesh(boxes):
    """把一堆轴对齐盒子拼成 (positions, normals, indices)，每面独立顶点（硬边）。"""
    positions: list[tuple[float, float, float]] = []
    normals: list[tuple[float, float, float]] = []
    indices: list[int] = []
    for x0, x1, y0, y1, z0, z1 in boxes:
        for normal, corners in FACES:
            start = len(positions)
            for cx, cy, cz in corners:
                positions.append((x0 if cx == 0 else x1,
                                  y0 if cy == 0 else y1,
                                  z0 if cz == 0 else z1))
                normals.append(normal)
            indices += [start, start + 1, start + 2, start, start + 2, start + 3]
    return positions, normals, indices


def panel_area(boxes) -> float:
    return sum((x1 - x0) * (z1 - z0) for x0, x1, _, _, z0, z1 in boxes)


# 三个开洞（u 起止, 排起止）。开洞之外的区域由 panels() 铺满。
OPENINGS = [
    (0.0, 15.0, 0, 6),        # 主区
    (15.25, 18.25, 0, 6),     # 导航区
    (18.5, 22.5, 1, 6),       # 小键盘（第 0 排右端是实心外壳）
]
STEP_U = 0.25                 # 网格精度：所有键宽/键位都是 0.25u 的整数倍


def layout_keys():
    """从 `relayout_keyboard_cat.py` 取布局——单一来源，别在这里再抄一份坐标。"""
    here = Path(__file__).resolve().parent
    if str(here) not in sys.path:
        sys.path.insert(0, str(here))
    import relayout_keyboard_cat as relayout

    return relayout.build_keys()


def blank_boxes(keys) -> list[tuple[float, float, float, float, float, float]]:
    """开洞之内**没有键**的地方，也要铺成外壳。

    这一条是补壳的第二刀：只看"外壳够不够厚"没用——F 区 Esc 后那 1u、四键一组之间的
    0.5u、导航区中间那片空白，都落在洞里，露出的是深色定位板，看起来就是"外壳缺了一块"。
    真实键盘这些位置是外壳的面，键帽才是洞。

    做法：0.25u 网格上，"格心落在某颗键的占位里"就算被占；剩下的空格合并成矩形铺成面板。
    键与键之间 0.45mm 的缝不足一格，所以不会被当成洞——那点缝本来就该露出定位板。
    """
    cols, rows = int(round(22.5 / STEP_U)), 6
    occupied = [[False] * cols for _ in range(rows)]
    for key in keys:
        c0 = int(round(key["u"] / STEP_U))
        c1 = int(round((key["u"] + key["w"]) / STEP_U))
        r0 = int(round(key["row"]))
        r1 = int(round(key["row"] + key["h"]))
        for r in range(r0, r1):
            for c in range(c0, c1):
                occupied[r][c] = True

    inside = [[False] * cols for _ in range(rows)]
    for start_u, end_u, r0, r1 in OPENINGS:
        for r in range(r0, r1):
            for c in range(int(round(start_u / STEP_U)), int(round(end_u / STEP_U))):
                inside[r][c] = True

    blank = [[inside[r][c] and not occupied[r][c] for c in range(cols)] for r in range(rows)]
    used = [[False] * cols for _ in range(rows)]
    boxes = []
    for r in range(rows):
        for c in range(cols):
            if not blank[r][c] or used[r][c]:
                continue
            c_end = c
            while c_end + 1 < cols and blank[r][c_end + 1] and not used[r][c_end + 1]:
                c_end += 1
            r_end = r
            while r_end + 1 < rows and all(
                blank[r_end + 1][cc] and not used[r_end + 1][cc]
                for cc in range(c, c_end + 1)
            ):
                r_end += 1
            for rr in range(r, r_end + 1):
                for cc in range(c, c_end + 1):
                    used[rr][cc] = True
            x0 = -HALF_W + c * STEP_U * PITCH
            x1 = -HALF_W + (c_end + 1) * STEP_U * PITCH
            # 第 r 排在 z 的负半边（第 0 排 = F 区 = 最后方）。这里曾经写反成 HALF_D - r*PITCH，
            # 补块就整排跑到底排、压在键帽底下——F 区的洞看着一直没补上。
            z0 = -HALF_D + r * PITCH
            z1 = -HALF_D + (r_end + 1) * PITCH
            boxes.append((round(x0, 6), round(x1, 6),
                          FRAME_BOTTOM, FRAME_TOP,
                          round(z0, 6), round(z1, 6)))
    return boxes


def expected_area(keys) -> float:
    """外壳矩形 - 每颗键的占位，就是这块面板应该占的面积。"""
    outer = (2 * CASE_HALF_W) * (2 * CASE_HALF_D)
    keys_area = sum(key["w"] * key["h"] for key in keys) * PITCH * PITCH
    return outer - keys_area


def read_glb(path: Path):
    raw = path.read_bytes()
    magic, _version, total = struct.unpack_from("<III", raw, 0)
    if magic != 0x46546C67:
        raise SystemExit("不是 GLB: %s" % path)
    offset, gltf, binary = 12, None, b""
    while offset < total:
        length, kind = struct.unpack_from("<II", raw, offset)
        payload = raw[offset + 8: offset + 8 + length]
        if kind == 0x4E4F534A:
            gltf = json.loads(payload.decode("utf-8"))
        elif kind == 0x004E4942:
            binary = payload
        offset += 8 + length
    return gltf, binary


def write_glb(path: Path, gltf, binary: bytes):
    blob = json.dumps(gltf, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    blob += b" " * ((4 - len(blob) % 4) % 4)
    binary += b"\x00" * ((4 - len(binary) % 4) % 4)
    total = 12 + 8 + len(blob) + 8 + len(binary)
    out = bytearray(struct.pack("<III", 0x46546C67, 2, total))
    out += struct.pack("<II", len(blob), 0x4E4F534A) + blob
    out += struct.pack("<II", len(binary), 0x004E4942) + binary
    path.write_bytes(bytes(out))


def node_named(gltf, name: str):
    return next((node for node in gltf["nodes"] if node.get("name") == name), None)


def add_case_top(gltf, binary) -> tuple[int, bytes]:
    """补上盖。返回 (新增节点数, 新 BIN)。"""
    keys = layout_keys()
    fillers = blank_boxes(keys)
    boxes = panels() + fillers
    positions, normals, indices = build_mesh(boxes)
    got, want = panel_area(boxes), expected_area(keys)
    print("[INFO] 上盖：边框与隔条 %d 块 + 空位补齐 %d 块" % (len(panels()), len(fillers)))
    print("[INFO] 面板面积 %.2f mm^2（外壳 %.2f - 键帽占位 %.2f = 期望 %.2f）"
          % (got, (2 * CASE_HALF_W) * (2 * CASE_HALF_D),
             (2 * CASE_HALF_W) * (2 * CASE_HALF_D) - want, want))
    if abs(got - want) > 1e-3:
        raise SystemExit("[FAIL] 洞口没对齐：面积 %.3f != %.3f" % (got, want))

    material = case_top_material(gltf)

    while len(binary) % 4:
        binary += b"\x00"
    offset = len(binary)
    packed_pos = b"".join(struct.pack("<3f", *p) for p in positions)
    packed_nrm = b"".join(struct.pack("<3f", *n) for n in normals)
    index_type = 5125 if len(positions) > 65535 else 5123
    index_format = "<I" if index_type == 5125 else "<H"
    packed_idx = b"".join(struct.pack(index_format, i) for i in indices)
    binary += packed_pos + packed_nrm + packed_idx
    while len(binary) % 4:
        binary += b"\x00"

    views = gltf.setdefault("bufferViews", [])
    pos_view = len(views)
    views.append({"buffer": 0, "byteOffset": offset,
                  "byteLength": len(packed_pos), "target": 34962})
    nrm_view = len(views)
    views.append({"buffer": 0, "byteOffset": offset + len(packed_pos),
                  "byteLength": len(packed_nrm), "target": 34962})
    idx_view = len(views)
    views.append({"buffer": 0, "byteOffset": offset + len(packed_pos) + len(packed_nrm),
                  "byteLength": len(packed_idx), "target": 34963})

    accessors = gltf.setdefault("accessors", [])
    low = [min(p[i] for p in positions) for i in range(3)]
    high = [max(p[i] for p in positions) for i in range(3)]
    pos_acc = len(accessors)
    accessors.append({"bufferView": pos_view, "componentType": 5126,
                      "count": len(positions), "type": "VEC3",
                      "min": [round(v, 6) for v in low],
                      "max": [round(v, 6) for v in high]})
    nrm_acc = len(accessors)
    accessors.append({"bufferView": nrm_view, "componentType": 5126,
                      "count": len(normals), "type": "VEC3"})
    idx_acc = len(accessors)
    accessors.append({"bufferView": idx_view, "componentType": index_type,
                      "count": len(indices), "type": "SCALAR"})

    meshes = gltf.setdefault("meshes", [])
    meshes.append({"name": "Case_TopMesh", "primitives": [{
        "attributes": {"POSITION": pos_acc, "NORMAL": nrm_acc},
        "indices": idx_acc, "material": material}]})
    node_index = len(gltf["nodes"])
    gltf["nodes"].append({"name": "Case_Top", "mesh": len(meshes) - 1})
    gltf["buffers"][0]["byteLength"] = len(binary)

    # 必须挂在 KeyboardRoot 下：那一层带 0.001 缩放，节点坐标才是毫米
    root = node_named(gltf, "KeyboardRoot")
    root.setdefault("children", []).append(node_index)
    print("[OK] 上盖：%d 块面板 / %d 三角面 / 厚度 %.1fmm / 顶面 y=%.1f / 节点 #%d"
          % (len(boxes), len(indices) // 3, FRAME_TOP - FRAME_BOTTOM, FRAME_TOP, node_index))
    return 1, binary


def recolour_plate(gltf) -> int:
    """定位板压深：新材质 MAT_Plate 贴到 Plate 上。返回改动数。"""
    plate = node_named(gltf, "Plate")
    if plate is None or "mesh" not in plate:
        raise SystemExit("找不到 Plate 节点")
    primitive = gltf["meshes"][plate["mesh"]]["primitives"][0]
    materials = gltf.setdefault("materials", [])
    index = next((i for i, item in enumerate(materials) if item.get("name") == "MAT_Plate"), None)
    if index is None:
        materials.append({
            "name": "MAT_Plate",
            "pbrMetallicRoughness": {
                "baseColorFactor": PLATE_COLOR,
                "metallicFactor": 0,
                "roughnessFactor": 0.62,
            },
        })
        index = len(materials) - 1
    primitive["material"] = index
    print("[OK] 定位板 -> MAT_Plate=#%d，baseColorFactor=%s" % (index, PLATE_COLOR))
    return 1


def main() -> int:
    global FRAME_TOP

    here = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(description="给键盘补上盖 + 压深定位板")
    ap.add_argument("--glb", type=Path,
                    default=here / "src/omnisight/presentation/static/assets/keyboard.glb")
    ap.add_argument("--check", action="store_true", help="只自检，不写文件")
    ap.add_argument("--apply", action="store_true", help="备份后写回")
    ap.add_argument("--top", type=float, default=FRAME_TOP,
                    help="上盖顶面高度(mm)，默认 %(default)s；键帽顶约 30.5")
    ap.add_argument("--prune", action="store_true",
                    help="同时同步 assets/models/keyboard-cat.glb")
    args = ap.parse_args()
    FRAME_TOP = args.top

    gltf, binary = read_glb(args.glb)
    changes = 0

    if node_named(gltf, "Case_Top"):
        print("[SKIP] 已经有 Case_Top")
    else:
        added, binary = add_case_top(gltf, binary)
        changes += added

    if any(item.get("name") == "MAT_Plate" for item in gltf.get("materials", [])):
        print("[SKIP] 已经有 MAT_Plate")
    else:
        changes += recolour_plate(gltf)

    if changes == 0:
        print("[OK] 已经是处理过的模型，无需改动")
        return 0
    if not args.apply:
        print("[DRY] 未写文件。确认无误后加 --apply")
        return 0

    backup = args.glb.with_name(args.glb.stem + ".before-dress.glb")
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
