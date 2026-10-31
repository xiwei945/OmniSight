"""鼠标按键采集编排。

与 :mod:`omnisight.capture.keyboard` 是同一个结构、更少的步骤：

* 键盘要等抬起才能算一次"按压"（时长是它的核心指标），鼠标**在按下时就计数**——
  "点了多少次"在按下那一刻就是事实，等待抬起只会把长按与拖拽算成同一次点击的尾巴。
* 因此这里没有 ``_pressed`` 表、没有配对、没有卡键截断。**抬起事件直接丢掉**，
  只统计一个 ``ignored_releases`` 供诊断（后端重复上报抬起时那个数字会涨）。

热路径同样只做纯内存操作：查表、取归因、入队。归因在**采集时刻**解析（与键盘同一条
规则），因此"这个点击属于哪个应用"不依赖查询期还能不能还原当时的前台。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from ..adapters.ports import CaptureUnavailable, MouseSource, RawMouseEvent
from ..capture.coordinator import CaptureCoordinator
from .models import MouseClick
from .queue import EventQueue

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class MouseStats:
    clicks: int = 0
    #: 没有对应按下的抬起。正常情况下等于 ``clicks``（每次点击都有一条抬起），
    #: 明显大于它说明后端在重复上报。
    ignored_releases: int = 0

    def as_dict(self) -> dict[str, int]:
        return {"clicks": self.clicks, "ignored_releases": self.ignored_releases}


class MouseCapture:
    """把 :class:`MouseSource` 的原始上报变成带归因的 :class:`MouseClick`。"""

    def __init__(
        self,
        source: MouseSource,
        coordinator: CaptureCoordinator,
        queue: EventQueue,
        *,
        paused: bool = False,
    ) -> None:
        self._source = source
        self._coordinator = coordinator
        self._queue = queue
        self._paused = paused
        self.stats = MouseStats()

    # ── 生命周期 ────────────────────────────────────────────────────────
    @property
    def running(self) -> bool:
        return bool(self._source.running)

    @property
    def backend_name(self) -> str:
        return self._source.backend_name

    @property
    def paused(self) -> bool:
        return self._paused

    def start(self) -> None:
        """启动后端。失败抛 :class:`CaptureUnavailable`，**不应导致程序退出**。"""
        self._source.start(self._on_raw)

    def stop(self) -> None:
        self._source.stop()

    def pause(self) -> None:
        """暂停。鼠标没有半截状态要清，一个布尔就够了。"""
        self._paused = True

    def resume(self) -> None:
        self._paused = False

    def snapshot(self) -> dict[str, object]:
        return {
            "running": self.running,
            "backend": self.backend_name,
            "paused": self._paused,
            "unmapped_events": int(getattr(self._source, "unmapped_events", 0)),
            **self.stats.as_dict(),
        }

    # ── 热路径 ──────────────────────────────────────────────────────────
    def _on_raw(self, event: RawMouseEvent) -> None:
        if self._paused:
            return
        if not event.pressed:
            self.stats.ignored_releases += 1
            return
        self.stats.clicks += 1
        attribution = self._coordinator.attribution()
        self._queue.put(
            MouseClick(
                button_id=event.button_id,
                ts_ns=event.wall_ts_ns,
                app_id=attribution.app_id,
                confidence=attribution.confidence,
                native_code=event.native_code,
            )
        )


__all__ = ["CaptureUnavailable", "MouseCapture", "MouseStats"]
