"""鼠标按键采集的产品语义（11 文档 §3.4 的同构）。

与键盘不同的一条核心规则：**按下就记一次，抬起丢掉**。它在这里固定住，三个平台
（Windows 现在有实现，macOS / Linux 还没有）拿到同一个行为——鼠标适配器只负责
忠实上报按下与抬起。
"""

from __future__ import annotations

import pytest

from fakes import FakeClock, FakeMouseSource
from omnisight.adapters.ports import CaptureUnavailable
from omnisight.capture.coordinator import CaptureCoordinator
from omnisight.capture.models import MouseClick
from omnisight.capture.mouse import MouseCapture
from omnisight.capture.queue import EventQueue


def _capture(clock: FakeClock, *, paused: bool = False, **kwargs):
    source = FakeMouseSource(clock, **kwargs)
    queue = EventQueue()
    coordinator = CaptureCoordinator(monotonic=clock.monotonic)
    capture = MouseCapture(source, coordinator, queue, paused=paused)
    capture.start()
    return capture, source, queue, coordinator


def _clicks(queue: EventQueue) -> list[MouseClick]:
    return [event for event in queue.drain_all() if isinstance(event, MouseClick)]


def test_one_click_is_counted_on_press_not_release():
    clock = FakeClock()
    capture, source, queue, _ = _capture(clock)
    source.click("mouse_left", hold_ms=90)

    clicks = _clicks(queue)
    assert len(clicks) == 1, "按下就记一次；抬起不该再记一次"
    assert clicks[0].button_id == "mouse_left"
    assert capture.stats.clicks == 1
    # 抬起确实收到了——只是没有落盘（它是诊断数，不是数据）。
    assert capture.stats.ignored_releases == 1


def test_every_button_is_its_own_id():
    clock = FakeClock()
    _capture_obj, source, queue, _ = _capture(clock)
    for button_id in ("mouse_left", "mouse_right", "mouse_middle", "mouse_x1", "mouse_x2"):
        source.click(button_id)
    assert [event.button_id for event in _clicks(queue)] == [
        "mouse_left",
        "mouse_right",
        "mouse_middle",
        "mouse_x1",
        "mouse_x2",
    ]


def test_long_press_and_double_click_count_as_two_clicks():
    """这一版没有时长，因此"按住"与"点一下"都只算一次；但连续两次点必须是两次。

    后者是真会发生的边界：双击在 Raw Input 里就是两对按下/抬起，而不是一条事件。
    """
    clock = FakeClock()
    capture, source, queue, _ = _capture(clock)
    source.click("mouse_left", hold_ms=1200)
    source.click("mouse_left", hold_ms=40)
    assert capture.stats.clicks == 2
    assert len(_clicks(queue)) == 2


def test_clicks_carry_the_foreground_app_of_the_moment():
    """★ 归因在采集时刻完成：查询期还原不出"当时前台是谁"（04 文档 §4.3）。"""
    clock = FakeClock()
    source = FakeMouseSource(clock)
    queue = EventQueue()
    coordinator = CaptureCoordinator(monotonic=clock.monotonic)
    # 真实链路上 app_id 由前台监控线程解析后写进中枢；这里直接给一个已知 id，
    # 要验证的是"采集层读的是中枢的值"，不是解析本身。
    coordinator.set_foreground(42)
    capture = MouseCapture(source, coordinator, queue)
    capture.start()

    source.click("mouse_right")
    click = _clicks(queue)[0]
    assert click.app_id == 42
    assert click.confidence in {"high", "boundary"}


def test_unknown_foreground_uses_the_sentinel_app_id():
    clock = FakeClock()
    _capture_obj, source, queue, _ = _capture(clock)
    source.click("mouse_left")
    assert _clicks(queue)[0].app_id == 0


def test_paused_capture_records_nothing():
    """暂停必须是真的暂停（11 文档 §4.5）。"""
    clock = FakeClock()
    capture, source, queue, _ = _capture(clock, paused=True)
    source.click("mouse_left")
    assert _clicks(queue) == []
    assert capture.stats.clicks == 0

    capture.resume()
    source.click("mouse_left")
    assert capture.stats.clicks == 1


def test_start_failure_is_not_fatal_to_the_caller():
    clock = FakeClock()
    source = FakeMouseSource(clock, fail_on_start=True)
    capture = MouseCapture(source, CaptureCoordinator(monotonic=clock.monotonic), EventQueue())
    with pytest.raises(CaptureUnavailable):
        capture.start()


def test_snapshot_reports_backend_and_counters():
    clock = FakeClock()
    capture, source, queue, _ = _capture(clock)
    source.click("mouse_left")
    snapshot = capture.snapshot()
    assert snapshot["running"] is True
    assert snapshot["backend"] == "fake"
    assert snapshot["clicks"] == 1
    assert snapshot["paused"] is False
