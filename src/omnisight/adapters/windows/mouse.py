"""把 Raw Input 鼠标监听器适配为 :class:`~omnisight.adapters.ports.MouseSource`。

与键盘那条一样是**薄封装**：``raw_mouse.py`` 是 ctypes 层，本文件只做按钮位 → ``button_id``
的映射与时间戳。映射是纯函数表，不依赖真实鼠标即可测试。

**时间戳在这里盖**（离事件最近），墙钟定日期桶、单调钟留给以后的时长类指标。
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable

from ..ports import CaptureUnavailable, RawMouseEvent
from . import raw_mouse
from .raw_mouse import RawInputMouseListener

logger = logging.getLogger(__name__)

BACKEND_NAME = "raw_input"

#: 原生按钮位 → 稳定 ``button_id``。按下的位在 :data:`_DOWN_BITS`，抬起的位由
#: :data:`_UP_BITS` 映射到同一个 id——采集层只数按下，但抬起也要如实上报（诊断用）。
_BUTTON_BY_BIT: dict[int, str] = {
    raw_mouse.RI_MOUSE_LEFT_BUTTON_DOWN: "mouse_left",
    raw_mouse.RI_MOUSE_LEFT_BUTTON_UP: "mouse_left",
    raw_mouse.RI_MOUSE_RIGHT_BUTTON_DOWN: "mouse_right",
    raw_mouse.RI_MOUSE_RIGHT_BUTTON_UP: "mouse_right",
    raw_mouse.RI_MOUSE_MIDDLE_BUTTON_DOWN: "mouse_middle",
    raw_mouse.RI_MOUSE_MIDDLE_BUTTON_UP: "mouse_middle",
    raw_mouse.RI_MOUSE_BUTTON_4_DOWN: "mouse_x1",
    raw_mouse.RI_MOUSE_BUTTON_4_UP: "mouse_x1",
    raw_mouse.RI_MOUSE_BUTTON_5_DOWN: "mouse_x2",
    raw_mouse.RI_MOUSE_BUTTON_5_UP: "mouse_x2",
}


def button_of(bit: int) -> str | None:
    """原生按钮位 → ``button_id``。认不出时返回 ``None``（由调用方计诊断数）。"""
    return _BUTTON_BY_BIT.get(int(bit))


class RawInputMouseSource:
    """Windows 一级鼠标后端：后台窗口与全屏独占程序里的点击都能收到。

    ``Raw Input`` 的鼠标注册与键盘同样受权限边界约束：发往更高权限进程的点击收不到
    （托盘「以管理员身份重启」补的就是这个缺口，与键盘同一套说明）。
    """

    __slots__ = ("_listener", "_on_session_end", "_sink", "_unmapped")

    def __init__(self, *, on_session_end: Callable[[], None] | None = None) -> None:
        self._listener: RawInputMouseListener | None = None
        self._sink: Callable[[RawMouseEvent], None] | None = None
        self._on_session_end = on_session_end
        self._unmapped = 0

    @property
    def backend_name(self) -> str:
        return BACKEND_NAME

    @property
    def running(self) -> bool:
        return bool(self._listener and self._listener.running)

    @property
    def unmapped_events(self) -> int:
        """收到但映射不到 ``button_id`` 的原生按钮数（厂商自定义键）。

        与键盘的 ``unmapped_events`` 同一个用处：让"某个键从来没被记录"在
        ``/api/v1/status`` 上看得见。
        """
        return self._unmapped

    def start(self, sink: Callable[[RawMouseEvent], None]) -> None:
        if self.running:
            return
        self._sink = sink
        listener = RawInputMouseListener(self._on_raw, on_session_end=self._on_session_end)
        try:
            listener.start()
        except (OSError, RuntimeError) as exc:
            # 不致命：键盘、屏幕时间与整个程序都要继续可用（10 文档 §6）。
            raise CaptureUnavailable(f"鼠标 Raw Input 注册失败：{exc}") from exc
        self._listener = listener
        logger.info("鼠标采集已启动，后端 %s", BACKEND_NAME)

    def stop(self) -> None:
        listener, self._listener = self._listener, None
        if listener is not None:
            listener.stop()
        self._sink = None

    # ── 回调（运行在消息泵线程上，必须极快）──────────────────────────────
    def _on_raw(self, bit: int, pressed: bool) -> None:
        button_id = button_of(bit)
        if button_id is None:
            self._unmapped += 1
            return
        sink = self._sink
        if sink is None:  # pragma: no cover - stop() 与在途消息竞态
            return
        sink(
            RawMouseEvent(
                button_id=button_id,
                pressed=pressed,
                wall_ts_ns=time.time_ns(),
                mono_ts_ns=time.perf_counter_ns(),
                native_code=int(bit),
            )
        )


__all__ = ["BACKEND_NAME", "RawInputMouseSource", "button_of"]
