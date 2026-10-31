"""鼠标接口与聚合口径（05 文档 §4 的同构面板）。

三条这里固定住、以后改口径会立刻变红的约定：

1. **五个按键始终全返回**，且加起来等于总数——面板上五根条对不上总数时，用户会先怀疑
   程序坏了，而不是怀疑"还有个侧键没显示"；
2. **跳过的周期没有"上一周期"**（``range=total``），那时 ``delta_vs_previous`` 为
   ``null`` 而不是 0；
3. **没有点击时键鼠比是 ``null`` 而不是 0**——0 会被读成"点了很多次但一次键没按"。
"""

from __future__ import annotations

import pytest

from seeded import EXPECTED_MOUSE, NOW, TZ

from omnisight.capture.models import MouseClick
from omnisight.capture.queue import EventQueue
from omnisight.storage.writer import StorageWriter

DAY = "range=day&date=2026-09-02"


def _get(client, query: str = ""):
    response = client.get("/api/v1/mouse" + (f"?{query}" if query else ""))
    assert response.status_code == 200, response.get_data(as_text=True)
    return response.get_json()


def _anchor(range_name: str) -> str:
    return "" if range_name == "total" else f"&date={NOW.date().isoformat()}"


def test_each_period_counts_the_documented_clicks(seeded_client):
    """数据集见 tests/seeded.py 的 ``MOUSE_PLAN``（手算的期望值在 ``EXPECTED_MOUSE``）。"""
    for range_name, expected in EXPECTED_MOUSE.items():
        payload = _get(seeded_client, f"range={range_name}{_anchor(range_name)}")
        assert payload["totals"]["click_count"] == expected, range_name


def test_button_split_is_complete_and_sums_to_the_total(seeded_client):
    payload = _get(seeded_client, DAY)
    buttons = payload["buttons"]
    assert [item["id"] for item in buttons] == [
        "mouse_left",
        "mouse_right",
        "mouse_middle",
        "mouse_x1",
        "mouse_x2",
    ]
    assert sum(item["click_count"] for item in buttons) == payload["totals"]["click_count"]
    counts = {item["id"]: item["click_count"] for item in buttons}
    assert counts["mouse_left"] == 7
    assert counts["mouse_right"] == 1
    assert counts["mouse_middle"] == 0
    # 百分比之和允许有舍入误差，但不能差出 0.5 个点。
    assert abs(sum(item["percent"] for item in buttons) - 100) < 0.5


def test_apps_ranking_folds_the_clicks_of_the_period(seeded_client):
    payload = _get(seeded_client, DAY)
    by_name = {row["display_name"]: row["click_count"] for row in payload["apps"]}
    assert by_name["Visual Studio Code"] == 6
    assert by_name["Google Chrome"] == 2
    assert sum(by_name.values()) == payload["totals"]["click_count"]


def test_hours_always_cover_the_whole_day(seeded_client):
    payload = _get(seeded_client, DAY)
    hours = payload["hours"]
    assert [item["hour"] for item in hours] == list(range(24))
    counts = {item["hour"]: item["click_count"] for item in hours}
    assert counts[10] == 6
    assert counts[11] == 2
    assert sum(counts.values()) == payload["totals"]["click_count"]


def test_day_timeline_has_one_bucket_per_day(seeded_client):
    payload = _get(seeded_client, "range=week&date=2026-09-02")
    timeline = payload["days"]
    assert timeline["grain"] == "day"
    # 自然周从周一起，但**未来日期截断到今天**（9/2）：因此是 8/31、9/1、9/2 三根。
    assert [item["bucket"] for item in timeline["buckets"]] == [
        "2026-08-31",
        "2026-09-01",
        "2026-09-02",
    ]
    assert sum(item["click_count"] for item in timeline["buckets"]) == 14


def test_long_spans_switch_to_monthly_buckets(seeded_client):
    """一年 365 根柱在 1080px 里读不出形状，因此超过 120 天改用月桶。"""
    payload = _get(seeded_client, "range=total")
    timeline = payload["days"]
    assert timeline["grain"] == "month"
    assert 1 < len(timeline["buckets"]) <= 12
    assert sum(item["click_count"] for item in timeline["buckets"]) == EXPECTED_MOUSE["total"]


def test_keyboard_ratio_uses_the_same_period(seeded_client):
    payload = _get(seeded_client, DAY)
    # 同一天：按键 7、点击 8 → 每次点击配 0.88 次按键。
    assert payload["keyboard"]["press_count"] == 7
    assert payload["keyboard"]["presses_per_click"] == pytest.approx(0.88)


def test_total_range_has_no_previous_period(seeded_client):
    payload = _get(seeded_client, "range=total")
    assert payload["totals"]["delta_vs_previous"] is None


def test_day_delta_compares_with_yesterday(seeded_client):
    payload = _get(seeded_client, DAY)
    delta = payload["totals"]["delta_vs_previous"]
    # 昨天（9/1）2 次 → 今天 8 次，差 +6，涨幅 300%。
    assert delta == {"clicks": 6, "percent": 300.0}


def test_empty_library_returns_a_complete_shape(api_client):
    """空库必须 200 + 结构完整（11 文档 §4.3）：前端不该为"还没数据"写第二套分支。"""
    payload = _get(api_client, DAY)
    assert payload["totals"]["click_count"] == 0
    assert len(payload["buttons"]) == 5
    assert payload["apps"] == []
    assert len(payload["hours"]) == 24
    assert payload["days"]["buckets"] == [
        {"bucket": "2026-09-02", "label": "9/2", "click_count": 0}
    ]
    assert payload["keyboard"]["presses_per_click"] is None


def test_integrity_cross_checks_every_mouse_aggregate(seeded_client):
    """五张表存的是同一个事实的五种切法，任何一张对不上都说明某条 upsert 漏了。"""
    payload = seeded_client.get("/api/v1/maintenance/integrity").get_json()
    assert payload["mouse_match"] is True
    assert set(payload["mouse"]) == {
        "agg_mouse_button_day",
        "agg_mouse_button_total",
        "agg_mouse_app_day",
        "agg_mouse_app_total",
        "agg_mouse_hour",
    }
    assert set(payload["mouse"].values()) == {EXPECTED_MOUSE["total"]}


def test_unattributed_clicks_still_count_towards_the_total(database):
    """没有前台时的点击归到 app_id = 0，**必须仍然进总数**——否则总量会悄悄少一截。"""
    queue = EventQueue()
    writer = StorageWriter(
        database,
        queue,
        tz=TZ,
        store_raw=False,
        batch_max_wait_seconds=0.0,
        checkpoint_interval_seconds=0.0,
    )
    ts = int(NOW.timestamp() * 1_000_000_000)
    for index in range(4):
        queue.put(
            MouseClick(
                button_id="mouse_left",
                ts_ns=ts + index * 1_000_000_000,
                app_id=0,
                confidence="unknown",
            )
        )
    while queue.depth:
        writer.flush_once()

    conn = database.connect()
    total = conn.execute(
        "SELECT SUM(click_count) FROM agg_mouse_button_total"
    ).fetchone()[0]
    app_total = conn.execute(
        "SELECT SUM(click_count) FROM agg_mouse_app_total WHERE app_id = 0"
    ).fetchone()[0]
    hour_total = conn.execute("SELECT SUM(click_count) FROM agg_mouse_hour").fetchone()[0]
    assert total == app_total == hour_total == 4
