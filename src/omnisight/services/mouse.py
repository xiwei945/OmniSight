"""鼠标服务：点击分布、应用排行、时间分布、与键盘的对比。

**这一版只统计点击次数**（产品口径已定：按住时长、滚轮、光标移动都不采）。因此这里
没有"指标切换"——鼠标只有一个指标，面板不需要那张指标带。

三条与键盘服务刻意不同的取舍：

1. **五个按键始终全部返回**，包括 0 次。前端照着渲染五根条，不必为"这台机器没有第五
   键"分叉；百分比用总数当分母，0/0 时给 0。
2. **应用排行按 (应用, 按键) 折叠**。合并过的应用（``AppLens``）要把成员点击加回根上，
   否则"某个应用点得多"会因为它被合并过而显得少——与键盘的 ``by_app`` 同一个口径。
3. **新增的东西是"键鼠比"**：``presses_per_click`` = 这段时间的按键数 ÷ 点击次数。
   它回答的是"这段时间更像在打字还是在点"——单个数字，但它是两个面板各自都答不了的
   问题（而这正是合并项目该有的收益）。
"""

from __future__ import annotations

from ..capture.models import MOUSE_BUTTON_IDS
from . import formatting
from .apps import AppService
from .context import ServiceContext
from .period import Period, buckets_for, month_start, month_end

#: 按键 → 展示名。顺序就是界面上五根条的顺序：左、右、中、侧键 1、侧键 2。
BUTTONS: tuple[tuple[str, str], ...] = (
    ("mouse_left", "左键"),
    ("mouse_right", "右键"),
    ("mouse_middle", "中键"),
    ("mouse_x1", "侧键 1"),
    ("mouse_x2", "侧键 2"),
)

BUTTON_LABELS: dict[str, str] = dict(BUTTONS)

#: 逐日桶的上限。超过它就按**月**给桶：一年 365 根柱在 1080px 里每根不到 3px，
#: 而"这几个月点得多不多"用 12 个月度桶读起来清楚得多。
MAX_DAILY_BUCKETS = 120

#: 应用排行的上限。与键盘面板的 Top 条数同档；再多就要滚动，而排行榜的用处是
#: 一眼看出"最大的那几个"。
APP_LIMIT = 8

# 断言模块级常量的完整性：漏一个键就会让面板少画一根条，而那个键的点击仍然计入总数，
# 于是"五根条加起来不等于总数"。
assert set(MOUSE_BUTTON_IDS) == {button_id for button_id, _ in BUTTONS}


class MouseService:
    __slots__ = ("_apps", "_ctx")

    def __init__(self, ctx: ServiceContext, apps: AppService) -> None:
        self._ctx = ctx
        self._apps = apps

    def summary(self, period: Period) -> dict[str, object]:
        """一屏鼠标数据的**唯一请求**（与 ``/overview`` 同一个理由：五张卡各取一次
        就是五次往返，而它们来自同一批聚合行，算一次就够）。"""
        key = ("mouse.summary", period.range, period.day_range)
        return self._ctx.cached(key, lambda: self._summary(period))

    def _summary(self, period: Period) -> dict[str, object]:
        start_day, end_day = period.day_range
        buttons = self._buttons(period)
        click_count = sum(item["click_count"] for item in buttons)
        keyboard = self._keyboard(period, click_count)
        return {
            "scope": {"type": "all"},
            "buttons": buttons,
            "apps": self._apps_ranking(period),
            "hours": self._hours(period),
            "days": self._timeline(period),
            "totals": {
                "click_count": click_count,
                "active_days": self._ctx.mouse_repo.active_days(start_day, end_day),
                # 分母是**周期天数**（含没点击的日子），不是活跃天数——"这周平均每天
                # 点多少"如果把空档排除掉就成了另一个问题。字段名因此是 per_day。
                "per_day": _per_day(click_count, period),
                "delta_vs_previous": self._delta(period, click_count),
            },
            "keyboard": keyboard,
        }

    # ── 按键分布 ────────────────────────────────────────────────────────
    def _buttons(self, period: Period) -> list[dict[str, object]]:
        if period.range == "total":
            counts = self._ctx.mouse_repo.buttons_total()
        else:
            counts = self._ctx.mouse_repo.buttons_for_range(*period.day_range)
        total = sum(int(counts.get(button_id, 0)) for button_id, _ in BUTTONS)
        return [
            {
                "id": button_id,
                "label": label,
                "click_count": int(counts.get(button_id, 0)),
                "percent": formatting.percent(counts.get(button_id, 0), total),
            }
            for button_id, label in BUTTONS
        ]

    # ── 应用排行 ────────────────────────────────────────────────────────
    def _apps_ranking(self, period: Period) -> list[dict[str, object]]:
        if period.range == "total":
            rows = self._ctx.mouse_repo.apps_total(limit=APP_LIMIT)
        else:
            rows = self._ctx.mouse_repo.apps_for_range(*period.day_range, limit=APP_LIMIT)
        per_app: dict[int, int] = {}
        for row in rows:
            app_id = int(row["app_id"])
            per_app[app_id] = per_app.get(app_id, 0) + int(row["click_count"])
        lens = self._apps.lens()
        folded = lens.fold_counts(per_app, keep_unknown=True)
        total = sum(folded.values())
        ordered = sorted(folded.items(), key=lambda item: item[1], reverse=True)[:APP_LIMIT]
        return [
            {
                "app_id": app_id,
                "display_name": lens.name(app_id),
                "click_count": count,
                "percent": formatting.percent(count, total),
            }
            for app_id, count in ordered
        ]

    # ── 时间分布 ────────────────────────────────────────────────────────
    def _hours(self, period: Period) -> list[dict[str, int]]:
        counts = self._ctx.mouse_repo.hours(*period.day_range)
        return [{"hour": hour, "click_count": int(counts.get(hour, 0))} for hour in range(24)]

    def _timeline(self, period: Period) -> dict[str, object]:
        """逐日/逐月桶。**缺口补 0**：没点击的那天与"没有这一天"是两件事，前端不该猜。"""
        daily = self._ctx.mouse_repo.days(*period.day_range)
        grain = "day" if period.days <= MAX_DAILY_BUCKETS else "month"
        if grain == "day":
            buckets = [
                {"bucket": bucket, "label": label, "click_count": daily.get(bucket, 0)}
                for bucket, label in buckets_for("day", period.start, period.truncated_end)
            ]
            return {"grain": grain, "buckets": buckets}

        monthly: dict[str, int] = {}
        for day, count in daily.items():
            monthly[day[:7]] = monthly.get(day[:7], 0) + count
        buckets = [
            {"bucket": bucket, "label": label, "click_count": monthly.get(bucket, 0)}
            for bucket, label in _month_buckets(period)
        ]
        return {"grain": grain, "buckets": buckets}

    # ── 与键盘的对比 ────────────────────────────────────────────────────
    def _keyboard(self, period: Period, click_count: int) -> dict[str, object]:
        """键鼠比。``presses_per_click`` 为 ``None`` 表示这段没有点击——**不是 0**：
        0 会被读成"每次点击配 0 次按键"，而真相是分母不存在。"""
        if period.range == "total":
            presses = self._ctx.key_repo.press_total()
        else:
            presses = self._ctx.key_repo.press_total_range(*period.day_range)
        return {
            "press_count": presses,
            # 分母用同一份按钮下发的总数（而不是再查一次库），两个数字必然对得上。
            "presses_per_click": (
                round(presses / click_count, 2) if click_count else None
            ),
        }

    def _delta(self, period: Period, click_count: int) -> dict[str, object] | None:
        previous = self._ctx.previous_period(period)
        if previous is None:
            return None
        previous_count = self._ctx.mouse_repo.total_range(*previous.day_range)
        change = formatting.delta(click_count, previous_count)
        return {"clicks": int(change["value"]), "percent": change["percent"]}


def _per_day(click_count: int, period: Period) -> float:
    """日均点击次数。分母是周期天数（含没点击的日子）。"""
    return round(click_count / period.days, 1) if period.days else 0.0


def _month_buckets(period: Period) -> list[tuple[str, str]]:
    """跨越 ``MAX_DAILY_BUCKETS`` 天时用的月桶。起止对齐到月界，避免首尾半个月的桶。"""
    return buckets_for("month", month_start(period.start), month_end(period.truncated_end))


__all__ = [
    "APP_LIMIT",
    "BUTTON_LABELS",
    "BUTTONS",
    "MAX_DAILY_BUCKETS",
    "MouseService",
]
