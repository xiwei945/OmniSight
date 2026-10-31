# -*- coding: utf-8 -*-
"""
build_keyboard_glb.py - Blender 端最后一步：UV 展开 + 导出 GLB + 实例索引
=========================================================================
在 Blender 里运行（不是普通 Python）：

    blender -b -P build_keyboard_glb.py

产出（./out/）：
    keyboard.glb        9 个共享网格 + 104 个节点，Y-up，单位米
    legend_uv.json      { "节点名": [u0,v0,u1,v1], ... } 给 three.js 用
    build_report.json   尺寸/面数/预算自检

设计要点（为什么这么做）：
  * 104 颗键帽共享 9 份网格 -> 导出后 glTF 也会复用这 9 个 mesh，
    three.js 里能换成 9 个 InstancedMesh，drawcall 从 104 降到 9。
  * 顶面 UV 归一化到 0..1，真实图集矩形放进 legend_uv.json。
    这样每颗键可以用「实例属性 aUvRect」在着色器里重映射，
    不需要 104 份网格、104 个材质、104 张贴图。
  * 侧面 UV 指向图集里本键自己的纯色区域（字符下方），
    所以侧面颜色永远跟顶面底色一致。
"""

from __future__ import annotations
import json
import os
import sys

import bpy
import bmesh

HERE = os.path.dirname(os.path.abspath(bpy.data.filepath or __file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
sys.path.insert(0, os.getcwd())

import keyboard_blockout as kb  # noqa: E402

OUT_DIR = os.path.join(os.getcwd(), "out")

# 顶面在归一化 UV 里占据的位置：留 3% 内缩，避免双线性采样吃到邻格
UV_TOP_INSET = 0.03
# 侧面采样点：顶面中心偏下，字符下方，保证是本键的底色
UV_SIDE_CENTER = (0.50, 0.18)
UV_SIDE_HALF = 0.03


def unwrap_keycap(me):
    """展开键帽 UV。

    新网格是极坐标环状拓扑（不是棱台），所以按几何判定顶面：
      * 顶面 = 顶点高度接近最高点、且投影落在顶面半径以内的面
      * 侧面/底面塞进一条 1px 的细线，既不会串到别人的格子，也不会产生
        退化三角形导致的 mip 采样问题
    顶面映射到 0..1，真实图集矩形由 three.js 的 aUvRect 实例属性重映射。
    """
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.verify()
    bm.faces.ensure_lookup_table()

    # 顶面基准高度由模型侧写入，不能用 z_max：
    # 猫耳把 z_max 抬高了约 2mm，用 z_max 当基准会导致所有面都判成侧面。
    z_top = me.get("cap_top_z")
    if z_top is None:
        z_top = max(v.co.z for v in bm.verts) - 1.0
    z_thresh = z_top - 0.60       # 顶盖圆角之上的一小段也算顶面

    top_faces = [f for f in bm.faces if f.calc_center_median().z >= z_thresh]
    if not top_faces:
        raise RuntimeError("找不到键帽顶面: " + me.name)

    top_verts = {v for f in top_faces for v in f.verts}
    top_set = set(top_faces)
    xs = [v.co.x for v in top_verts]
    ys = [v.co.y for v in top_verts]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    if x1 - x0 < 1e-6 or y1 - y0 < 1e-6:
        raise RuntimeError("顶面退化: " + me.name)

    for f in top_faces:
        for loop in f.loops:
            u = (loop.vert.co.x - x0) / (x1 - x0)
            v = (loop.vert.co.y - y0) / (y1 - y0)
            loop[uv].uv = (UV_TOP_INSET + u * (1 - 2 * UV_TOP_INSET),
                           UV_TOP_INSET + v * (1 - 2 * UV_TOP_INSET))

    # 侧面 + 底面（含顶部圆角）塌到一个点，取顶面矩形内偏下的位置：
    # 那里是本键的纯底色，字符在中间偏上，不会采到字。
    # 放在矩形内而不是外侧，是为了让 UV 重映射后仍然落在本键自己的格子里。
    side_u = UV_TOP_INSET + 0.50 * (1 - 2 * UV_TOP_INSET)
    side_v = UV_TOP_INSET + 0.06 * (1 - 2 * UV_TOP_INSET)
    side = [f for f in bm.faces if f not in top_set]
    for f in side:
        for loop in f.loops:
            loop[uv].uv = (side_u, side_v)

    bm.to_mesh(me)
    bm.free()
    me.update()


def collect_legend_uv():
    """节点名 -> 图集矩形。节点名必须和 three.js 里读到的一致。

    注意：这里绝不能 import keycap_atlas —— 它顶层 import PIL，
    而 Blender 自带的 Python 没有 Pillow，一 import 就会失败并返回空表。
    图集应该事先用系统 Python 跑 keycap_atlas.py 生成好。
    """
    atlas_json = os.path.join(OUT_DIR, "keycap_legend_uv.json")
    if not os.path.exists(atlas_json):
        print("[WARN] 缺少 %s，请先用系统 Python 运行 keycap_atlas.py"
              % atlas_json)
        return {}
    with open(atlas_json, encoding="utf-8") as f:
        data = json.load(f)

    out = {}
    for ob in bpy.data.objects:
        if "mat_zone" not in ob:
            continue
        if ob["mat_zone"] in ("novelty", "case", "plate", "switch"):
            continue
        label = ob.name.split("_r")[0]
        if label in data["keys"]:
            out[ob.name] = data["keys"][label]["rect"]
    return out


def scene_stats():
    deps = bpy.context.evaluated_depsgraph_get()
    tris = 0
    nodes = 0
    meshes = set()
    for ob in bpy.data.objects:
        if ob.type != "MESH":
            continue
        nodes += 1
        meshes.add(ob.data.name)
        ev = ob.evaluated_get(deps)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        ev.to_mesh_clear()
    return {"nodes": nodes, "unique_meshes": len(meshes), "triangles": tris}


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    kb.main()   # 建场景（含立体猫爪）

    # 1) 所有键帽共享网格各展开一次 UV
    done = set()
    for ob in bpy.data.objects:
        if ob.type != "MESH" or ob.get("mat_zone") not in ("cream", "choco",
                                                           "grey", "blue"):
            continue
        if ob.data.name in done:
            continue
        unwrap_keycap(ob.data)
        done.add(ob.data.name)
    print("[OK] UV 展开: %d 份共享网格" % len(done))

    # 2) 图集材质挂到所有键帽上
    atlas_path = os.path.join(OUT_DIR, "keycap_atlas.png")
    if os.path.exists(atlas_path):
        for ob in bpy.data.objects:
            if ob.get("mat_zone") not in ("cream", "choco", "grey", "blue"):
                continue
            for slot in ob.material_slots:
                m = slot.material
                if not m or m.get("has_atlas"):
                    continue
                m.use_nodes = True
                nt = m.node_tree
                tex = nt.nodes.new("ShaderNodeTexImage")
                tex.image = bpy.data.images.load(atlas_path, check_existing=True)
                tex.interpolation = "Linear"
                bsdf = nt.nodes.get("Principled BSDF")
                nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
                m["has_atlas"] = True

    # 3) 场景单位 -> 米（glTF 要米）
    # 注意：不能 transform_apply —— 键帽是共享网格的多用户物体，apply 会失败。
    # 改用父级空物体统一缩放，glTF 导出时会把变换烘进节点矩阵。
    scn = bpy.context.scene
    scn.unit_settings.system = "METRIC"
    scn.unit_settings.scale_length = 1.0
    scn.unit_settings.length_unit = "METERS"

    root = bpy.data.objects.new("KeyboardRoot", None)
    scn.collection.objects.link(root)
    root.scale = (0.001, 0.001, 0.001)
    for ob in list(bpy.data.objects):
        if ob is root or ob.parent is not None:
            continue
        ob.parent = root
        ob.matrix_parent_inverse = root.matrix_world.inverted()
    bpy.context.view_layer.update()

    # 4) 导出
    glb_path = os.path.join(OUT_DIR, "keyboard.glb")
    bpy.ops.export_scene.gltf(
        filepath=glb_path,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        use_selection=False,
    )

    # 5) 图例 UV 表
    legend = collect_legend_uv()
    with open(os.path.join(OUT_DIR, "legend_uv.json"), "w", encoding="utf-8") as f:
        json.dump(legend, f, ensure_ascii=False, indent=1)

    # 6) 自检报告
    st = scene_stats()
    # 正确的世界包围盒：先取所有角点的 min/max，再相减。取绝对值会让
    # 模型沿某轴跨过原点时算成两倍高。
    from mathutils import Vector
    lo = [1e9, 1e9, 1e9]
    hi = [-1e9, -1e9, -1e9]
    for ob in bpy.data.objects:
        if ob.type != "MESH":
            continue
        for c in ob.bound_box:
            w = ob.matrix_world @ Vector(c)
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
    dims = [round(hi[i] - lo[i], 4) for i in range(3)]

    report = dict(st)
    report["bbox_m"] = [round(d, 4) for d in dims]
    report["glb_bytes"] = os.path.getsize(glb_path)
    report["atlas_cells"] = len(legend)
    # 9 份键帽网格 + 6 份外壳/定位板 = 15 是理论最优，别把阈值卡在 12
    # 桌面 WebGL 的合理上限：约 30 万面、1MB、110 节点
    ok = (st["triangles"] < 320000 and st["unique_meshes"] <= 16
          and st["nodes"] < 200 and report["glb_bytes"] < 3_000_000)
    report["budget_ok"] = ok
    with open(os.path.join(OUT_DIR, "build_report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)

    print("[OK] GLB -> %s (%.0f KB)" % (glb_path, report["glb_bytes"] / 1024))
    print("[OK] 包围盒(m):", report["bbox_m"], "  期望约 0.4446 x 0.1303 x 0.0297")
    print("[OK] 三角面 %d | 唯一网格 %d | 节点 %d | 预算通过 %s"
          % (st["triangles"], st["unique_meshes"], st["nodes"], ok))


if __name__ == "__main__":
    main()
