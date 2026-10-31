"""猫耳键盘资产的漂移检查。

这把键盘**不是**前端手工摆的：模型是 `keyboard_blockout.py` 生成、`bake_glb.py` 烘焙的
104 键 glb，键帽图集另外拍成一张中性版（白底深字）供运行时染色。提交进版本库的是产物，
因此这里盯的是产物本身的结构——换模型、重新导出、图集被覆盖，都会在这里变红。

和 `tests/frontend/keyboard-cat.test.ts` 的分工：那边用模型里的真实节点名核对
「节点名 → key_id」的翻译表，这边只看二进制结构（Python 侧没有前端那份表）。
"""

from __future__ import annotations

import json
import re
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "src" / "omnisight" / "presentation" / "static" / "assets"
MODEL = ASSETS / "keyboard.glb"
ATLAS = ASSETS / "keycap_atlas_neutral.png"

#: 键帽节点名：`图例_行_配色分区`。外壳节点（Case_*、Plate、KeyboardRoot）不匹配。
KEYCAP = re.compile(r"^.+_r\d+_(cream|choco|grey|blue)$")

SHELL_NODES = {
    "Case_Floor",
    "Case_Top",          # 上盖：tools/dress_keyboard_case.py 追加的开洞面板
    "Case_Wall_Back",
    "Case_Wall_Front",
    "Case_Wall_Left",
    "Case_Wall_Right",
    "KeyboardRoot",
    "Plate",
}


def glb_json() -> dict:
    """取出 glb 的 JSON chunk（前 12 字节是头，接着是 chunk 长度与类型）。"""
    data = MODEL.read_bytes()
    assert data[:4] == b"glTF", "3D 键盘资产不是 glTF 二进制"
    length = struct.unpack("<I", data[8:12])[0]
    assert length == len(data), "glb 头里的长度与文件实际大小不一致（写坏了）"
    chunk_length, chunk_type = struct.unpack("<II", data[12:20])
    assert chunk_type == 0x4E4F534A, "第一个 chunk 不是 JSON"
    return json.loads(data[20 : 20 + chunk_length].decode("utf-8"))


def test_the_3d_asset_is_committed_and_is_a_glb() -> None:
    assert MODEL.is_file(), "3D 键盘资产不在了"
    assert MODEL.read_bytes()[:4] == b"glTF"
    assert MODEL.stat().st_size > 1_000_000, "模型只有几百 KB，多半是导出中断了"


def test_the_model_has_104_keycaps_plus_the_shell() -> None:
    gltf = glb_json()
    names = [node.get("name", "") for node in gltf.get("nodes", [])]
    keycaps = [name for name in names if KEYCAP.match(name)]
    assert len(keycaps) == 104, f"键帽节点有 {len(keycaps)} 个，应为 104"
    assert len(set(keycaps)) == 104, "有重名键帽节点"
    assert set(names) - set(keycaps) == SHELL_NODES, (
        "外壳节点变了——取景与落影是按这几个名字算的"
    )


def test_keycaps_share_three_materials_and_one_atlas() -> None:
    gltf = glb_json()
    materials = sorted(material.get("name", "") for material in gltf.get("materials", []))
    # 键帽三份（奶油 / 巧克力 / 灰键，撞色键复用奶油那份）+ 外壳 + 上盖 + 定位板。
    assert materials == [
        "MAT_Case_Plastic",
        "MAT_Case_Top",
        "MAT_Keycap_Choco",
        "MAT_Keycap_Glossy",
        "MAT_Plate",
    ]
    # 图集是**内嵌**的：展示模式直接用它（奶油/巧克力本色），不再额外请求一张贴图。
    assert len(gltf.get("images", [])) == 1, "内嵌图集应当只有一张"


def _solid_top(gltf: dict, node_name: str) -> float:
    """某个外壳节点的顶面高度（毫米，glTF 的 y 向上）。"""
    node = next(item for item in gltf["nodes"] if item.get("name") == node_name)
    accessor = gltf["accessors"][
        gltf["meshes"][node["mesh"]]["primitives"][0]["attributes"]["POSITION"]
    ]
    return node.get("translation", (0.0, 0.0, 0.0))[1] + accessor["max"][1]


def test_the_case_has_a_top_layer_that_the_keys_come_out_of() -> None:
    """外壳顶面原本和定位板齐平（都是 18），整块键盘就是一只浅盘。

    补上 `Case_Top` 之后：它比定位板高，键帽又比它高出至少 4mm——这样键帽才是
    "从洞里钻出来"的，上下动的时候旁边有静止的参照物。
    """
    gltf = glb_json()
    plate_top = _solid_top(gltf, "Plate")
    frame_top = _solid_top(gltf, "Case_Top")
    assert 2.0 <= frame_top - plate_top <= 6.0, (
        f"上盖比定位板高 {frame_top - plate_top:.1f}mm，太薄读不出台阶、太厚会盖住键帽"
    )
    caps = _keycap_boxes()
    assert not any(name == "" for name in caps)
    lowest_cap_top = min(
        node["translation"][1]
        + gltf["accessors"][gltf["meshes"][node["mesh"]]["primitives"][0]
                            ["attributes"]["POSITION"]]["max"][1]
        for node in gltf["nodes"] if KEYCAP.match(node.get("name", ""))
    )
    assert lowest_cap_top - frame_top >= 4.0, (
        f"最矮的键帽只比上盖高 {lowest_cap_top - frame_top:.1f}mm，键帽会被埋进去"
    )


def test_the_case_top_has_no_hole_where_there_is_no_key() -> None:
    """键位区里"没键的地方"必须是外壳的面，不能露出下面更深色的定位板。

    这是补壳的第二刀：只把面板做成"三个大洞"是不够的——F 区 Esc 后那 1u、四键一组
    之间的 0.5u、导航区中间 57x19mm 的空白，全在洞里，露出来就是"外壳缺了一块"。
    这里把上盖的顶面连同键帽占位一起栅格化到 0.25u 网格上做覆盖检查。
    """
    gltf = glb_json()
    caps = _keycap_boxes()          # 名称 -> (中心x, 中心z, 宽, 深)
    pitch = 19.05
    step = 0.25 * pitch             # 4.7625mm
    half_w, half_d = 22.5 * pitch / 2, 6 * pitch / 2

    def cell_of(x: float, axis_half: float) -> int:
        """坐标 -> 格子下标（格心落在 (i + 0.5) * step - axis_half）。"""
        return int(round((x + axis_half) / step - 0.5))

    # 1) 键帽占位（按 0.25u 名义尺寸算：键帽实物比 1u 小 0.45mm，那点缝本来就该露定位板）
    keyed = set()
    for cx, cz, width, depth in caps.values():
        columns = round(width / pitch * 4)
        rows = round(depth / pitch * 4)
        for i in range(columns):
            for j in range(rows):
                keyed.add((cell_of(cx + (i - (columns - 1) / 2) * step, half_w),
                           cell_of(cz + (j - (rows - 1) / 2) * step, half_d)))

    # 2) 上盖的顶面（法线朝上）覆盖
    node = next(item for item in gltf["nodes"] if item.get("name") == "Case_Top")
    primitive = gltf["meshes"][node["mesh"]]["primitives"][0]
    positions = _accessor_floats(gltf, primitive["attributes"]["POSITION"], 3)
    normals = _accessor_floats(gltf, primitive["attributes"]["NORMAL"], 3)
    indices = _accessor_ints(gltf, primitive["indices"])
    covered = set()
    for triangle in range(0, len(indices), 3):
        corners = indices[triangle:triangle + 3]
        if any(normals[index][1] < 0.9 for index in corners):
            continue                 # 只认朝上的面
        xs = [positions[index][0] for index in corners]
        zs = [positions[index][2] for index in corners]
        for gx in range(int(round((min(xs) + half_w) / step)),
                        int(round((max(xs) + half_w) / step))):
            for gz in range(int(round((min(zs) + half_d) / step)),
                            int(round((max(zs) + half_d) / step))):
                covered.add((gx, gz))

    # 3) 键位区里每一个"没有键"的格子都必须被上盖盖住
    holes = []
    for gx in range(int(round(2 * half_w / step))):
        for gz in range(int(round(2 * half_d / step))):
            if (gx, gz) in keyed or (gx, gz) in covered:
                continue
            holes.append((round(-half_w + (gx + 0.5) * step, 1),
                          round(half_d - (gz + 0.5) * step, 1)))
    assert not holes, f"上盖在 {len(holes)} 个空格子上没铺：前几个 {holes[:6]}"


def _accessor_floats(gltf: dict, accessor_index: int, size: int) -> list[tuple[float, ...]]:
    accessor = gltf["accessors"][accessor_index]
    view = gltf["bufferViews"][accessor["bufferView"]]
    offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    raw = _glb_binary()[offset: offset + accessor["count"] * size * 4]
    values = struct.unpack("<%df" % (accessor["count"] * size), raw)
    return [values[i: i + size] for i in range(0, len(values), size)]


def _accessor_ints(gltf: dict, accessor_index: int) -> list[int]:
    accessor = gltf["accessors"][accessor_index]
    view = gltf["bufferViews"][accessor["bufferView"]]
    offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    code = "I" if accessor["componentType"] == 5125 else "H"
    width = 4 if code == "I" else 2
    raw = _glb_binary()[offset: offset + accessor["count"] * width]
    return list(struct.unpack("<%d%s" % (accessor["count"], code), raw))


def _glb_binary() -> bytes:
    data = MODEL.read_bytes()
    offset = 12
    while offset < len(data):
        length, kind = struct.unpack_from("<II", data, offset)
        if kind == 0x004E4942:
            return data[offset + 8: offset + 8 + length]
        offset += 8 + length
    raise AssertionError("glb 里没有 BIN chunk")


def test_the_three_case_tones_are_ordered() -> None:
    """三层要三种色阶，否则平光下就是"一整块白"：上盖最浅、外壳中间、定位板最深。"""

    def luminance(gltf: dict, name: str) -> float:
        material = next(item for item in gltf["materials"] if item.get("name") == name)
        red, green, blue, _alpha = material["pbrMetallicRoughness"]["baseColorFactor"]
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue

    gltf = glb_json()
    top = luminance(gltf, "MAT_Case_Top")
    case = luminance(gltf, "MAT_Case_Plastic")
    plate = luminance(gltf, "MAT_Plate")
    assert top > case + 0.02, "上盖没有比外壳更浅，台阶读不出来"
    assert case > plate + 0.1, "定位板没有明显比外壳深，键位区不会从壳里浮出来"


def test_the_neutral_atlas_is_committed_for_heat_tinting() -> None:
    """日常视图靠这张中性图集把底色交给运行时（`material.color` = 热力色）。"""
    assert ATLAS.is_file(), "中性图集不在了，日常热力视图会退化成原色"
    assert ATLAS.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    assert ATLAS.stat().st_size > 50_000, "中性图集太小，多半是没写全"


def test_the_neutral_atlas_keeps_the_atlas_layout() -> None:
    """两张图集必须同布局：模型烘的是 UV 矩形，换布局等于每颗键的字都错位。"""
    width, height = struct.unpack(">II", ATLAS.read_bytes()[16:24])
    assert (width, height) == (2880, 768), f"中性图集是 {width}x{height}，模型烘的是 2880x768"


# ---------------------------------------------------------------- #
# 排布：间距是烘在节点平移里的，结构测试看不见
#
# 2026-10-29 用户看图指出三处：F 区左端空档写成 1.5u、F 区组间距写成 0.25u、
# 小键盘整体高了一排（底排右侧空出 4u×1u 的死板）。三处都能通过"结构完整"的
# 测试，所以必须把标准 ANSI 104 的间距本身钉成断言。
# ---------------------------------------------------------------- #

PITCH = 19.05
BOARD_W = 22.5 * PITCH
BOARD_D = 6 * PITCH


def _keycap_boxes() -> dict[str, tuple[float, float, float, float]]:
    """节点名 -> (中心x, 中心z, 宽, 深)，单位 mm，坐标系同 glTF。"""
    gltf = glb_json()
    boxes = {}
    for node in gltf.get("nodes", []):
        name = node.get("name", "")
        if not KEYCAP.match(name):
            continue
        position = gltf["meshes"][node["mesh"]]["primitives"][0]["attributes"]["POSITION"]
        accessor = gltf["accessors"][position]
        low, high = accessor["min"], accessor["max"]
        tx, _, tz = node.get("translation", (0.0, 0.0, 0.0))
        boxes[name] = (tx, tz, high[0] - low[0], high[2] - low[2])
    return boxes


def _label(name: str) -> str:
    return name.rsplit("_r", 1)[0]


def test_keycaps_sit_on_a_19_05_mm_grid_without_overlapping() -> None:
    boxes = _keycap_boxes()
    assert len(boxes) == 104
    names = list(boxes)
    for name in names:
        cx, cz, width, depth = boxes[name]
        assert abs(cx) + width / 2 <= BOARD_W / 2 + 0.01, f"{name} 超出板宽"
        assert abs(cz) + depth / 2 <= BOARD_D / 2 + 0.01, f"{name} 超出板深"
        # 键帽宽度必须是 0.25u 的整数倍（1u / 1.25u / 1.5u / 1.75u / 2u / 2.25u…）
        units = width / PITCH
        assert abs(units - round(units * 4) / 4) < 0.06, f"{name} 宽度 {units:.3f}u 不是标准键宽"

    for i, a in enumerate(names):
        ax, az, aw, ad = boxes[a]
        for b in names[i + 1 :]:
            bx, bz, bw, bd = boxes[b]
            overlap_x = (aw + bw) / 2 - abs(ax - bx)
            overlap_z = (ad + bd) / 2 - abs(az - bz)
            assert not (overlap_x > 0.2 and overlap_z > 0.2), f"{_label(a)} 与 {_label(b)} 重叠"


def test_the_f_row_keeps_the_standard_group_gaps() -> None:
    """Esc 后 1u，四键一组之间 0.5u——这是"看起来就是一把标准键盘"的全部秘密。

    断言用**中心距**（整 u）而不是边缘间隙：键帽网格比 1u 略小（留了键缝），
    边缘间隙会随建模细节漂，中心距不会。
    """
    boxes = _keycap_boxes()
    center = {_label(name): value for name, value in boxes.items()}
    for left, right, distance_u in (
        ("Esc", "F1", 2.0),
        ("F1", "F2", 1.0),
        ("F4", "F5", 1.5),
        ("F8", "F9", 1.5),
        ("F9", "F12", 3.0),
    ):
        delta = center[right][0] - center[left][0]
        assert abs(delta / PITCH - distance_u) < 0.06, (
            f"{left} 与 {right} 中心距 {delta / PITCH:.2f}u，标准是 {distance_u}u"
        )
    # F1 必须压在「2」的正上方：Esc 与 F1 之间的空档错了，整组就会右移半格。
    assert abs(center["F1"][0] - center["2"][0]) < 0.01, "F1 没有对齐到「2」的正上方"


def test_the_numpad_sits_on_the_bottom_row() -> None:
    """NumLock 行与数字排同高，0 与空格同排——否则底排右侧会空出一块死板。"""
    boxes = _keycap_boxes()
    center = {_label(name): value for name, value in boxes.items()}
    assert abs(center["NumLock"][1] - center["Grave"][1]) < 0.01, "NumLock 行没有和数字排对齐"
    assert abs(center["Num0"][1] - center["Space"][1]) < 0.01, "0 没有落在底排"
    assert abs(center["NumDot"][1] - center["Space"][1]) < 0.01, "小数点没有落在底排"
    # 底排最右必须有键：小键盘右下角是 Enter，它跨 Shift 排和底排
    assert center["NumEnter"][0] > center["Num0"][0], "小键盘 Enter 不在最右列"
    assert abs(abs(center["NumEnter"][0]) + 9.525 - BOARD_W / 2) < 0.01, "小键盘右列没贴到板右缘"
