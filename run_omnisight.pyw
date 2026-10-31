"""从源码启动 OmniSight（开发用，双击不弹控制台）。

为什么单独一个文件：仓库是 src 布局，``python -m omnisight`` 要求包在
``sys.path`` 上，而快捷方式设不了环境变量。这里自己把两条路径塞进去：

* ``src``——项目源码；
* ``.venv\\Lib\\site-packages``——依赖。用 :func:`site.addsitedir` 而不是手动
  append，是因为 ``pywin32.pth`` 会把 ``win32`` / ``win32\\lib`` 三个目录加进来，
  手动加路径的话 ``import win32gui`` 直接 ModuleNotFoundError。

启动交给 ``main.py``：入口护栏、崩溃落盘、``--version`` 之类只有那一份实现。
**解释器用哪个都行**（本机实测：系统 Python 与 .venv 里的都能跑）。

**启动轨迹**（``_launch_trace.txt``）：pythonw 没有控制台，双击失败时
"什么都没发生"是最难查的一种症状。这里在最早的一行落一笔，任何一次双击
都能在仓库根看到它到底有没有跑起来、跑到哪一步死的。排查完可以删掉。
"""

from __future__ import annotations

import runpy
import site
import sys
import traceback
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV_SITE = ROOT / ".venv" / "Lib" / "site-packages"
TRACE = ROOT / ".dev" / "_launch_trace.txt"


def trace(message: str) -> None:
    try:
        with TRACE.open("a", encoding="utf-8") as handle:
            handle.write(f"{datetime.now().isoformat(timespec='seconds')} {message}\n")
    except OSError:
        pass


trace(f"启动 {sys.executable} / Python {sys.version.split()[0]} / cwd={Path.cwd()}")

if VENV_SITE.is_dir():
    site.addsitedir(str(VENV_SITE))
else:
    trace(f"警告：找不到 {VENV_SITE}，依赖可能缺失")
sys.path.insert(0, str(ROOT / "src"))

try:
    runpy.run_path(str(ROOT / "main.py"), run_name="__main__")
except SystemExit as exc:
    trace(f"退出码 {exc.code}")
    raise
except BaseException:
    trace("未捕获异常：\n" + traceback.format_exc())
    raise
