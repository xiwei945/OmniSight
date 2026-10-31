# 猫耳键盘的模型源（Blender 端）

这三个脚本原本只存在于宿主的**临时目录**里（`…\dshana\.runtime-tmp\…\default-workspace`），
随时可能被清掉；模型出问题时它们就是唯一的"从零重烤"入口，所以拷了一份进版本库。

```
keyboard_blockout.py    布局表 + 猫耳键帽几何 + 外壳，纯 Python 计算部分可被 import 做布局自检
keycap_atlas.py         画键帽图集（字符 + 分区底色），输出 out/keycap_atlas.png 与 keycap_legend_uv.json
build_keyboard_glb.py   在 Blender 里串起前两个：UV 展开 → 挂图集 → 导出 out/keyboard.glb
```

## 什么时候才需要动它们

**日常改键位、补外壳、调颜色都不要碰这里** —— 那些都在 `tools/` 里的脚本完成，只改 glb 的
节点平移和几何，键帽网格 / UV / 图集一个字节不动，风险最低：

- `tools/relayout_keyboard_cat.py` —— 按标准 ANSI 104 重排键帽坐标（`--check` / `--apply`）
- `tools/dress_keyboard_case.py` —— 补上盖 `Case_Top` + 定位板压深 `MAT_Plate`

只有要改**键帽形状**（猫耳、倒角、高度曲线）或**重画图集**时才走 Blender 重烤。

## 重烤流程

```powershell
# 1) 图集（系统 Python + Pillow，不是 Blender 自带的）
python keycap_atlas.py                 # -> out/keycap_atlas.png, out/keycap_legend_uv.json

# 2) Blender 4.3：建场景 + 展 UV + 导出
& "D:\Blender Foundation\Blender 4.3\blender.exe" -b -P build_keyboard_glb.py
#    -> out/keyboard.glb, out/legend_uv.json, out/build_report.json

# 3) 中性图集（日常热力视图用）
python "…\01_项目\omnisight-预览\make_neutral_atlas.py"

# 4) 换掉产物，重跑测试
copy out\keyboard.glb ..\..\src\omnisight\presentation\static\assets\keyboard.glb
python -m pytest tests\unit\test_keyboard_asset.py -q
```

注意两点：

1. `build_keyboard_glb.py` 里 `collect_legend_uv()` 读的是 `out/keycap_legend_uv.json`，
   **不要**让它 import `keycap_atlas` —— Blender 自带的 Python 没有 Pillow，一 import 就空表。
2. 重烤会重新分配节点名里的 `_r<行>`，行号变了不影响前端（`keyboard-cat.ts` 的
   `SUFFIX` 只取图例名和分区），但 `tests/frontend/keyboard-cat.test.ts` 是拿真实节点名
   核对的，烤完要跑一遍。
