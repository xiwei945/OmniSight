"""鼠标点击统计查询。

与 :mod:`keys` 同一条铁律：**只碰 ``agg_mouse_*``，任何常规查询不扫原始事件**。
鼠标根本没有原始表（一次点击就是一条事实，见 ``capture/mouse.py``），因此这里
连"回放"那两条例外都不存在。

五个方法各自对应一张表，不做跨表拼装：

* :meth:`buttons_for_range` / :meth:`buttons_total` —— 按键维度；
* :meth:`apps_for_range` / :meth:`apps_total` —— 应用 × 按键（服务层折叠合并应用）；
* :meth:`hours` / :meth:`days` —— 时间分布；
* :meth:`total_range` / :meth:`total_all` —— 总数（"键鼠比"与概览卡片用）。
"""

from __future__ import annotations

from sqlite3 import Connection

from ..database import Database


class MouseRepository:
    __slots__ = ("_db",)

    def __init__(self, db: Database) -> None:
        self._db = db

    def _conn(self) -> Connection:
        return self._db.connect()

    # ── 按键维度 ────────────────────────────────────────────────────────
    def buttons_for_range(self, start_day: str, end_day: str) -> dict[str, int]:
        rows = self._conn().execute(
            "SELECT button_id, SUM(click_count) AS click_count "
            "FROM agg_mouse_button_day WHERE day_bucket BETWEEN ? AND ? "
            "GROUP BY button_id",
            (start_day, end_day),
        )
        return {str(row["button_id"]): int(row["click_count"] or 0) for row in rows}

    def buttons_total(self) -> dict[str, int]:
        rows = self._conn().execute(
            "SELECT button_id, click_count FROM agg_mouse_button_total"
        )
        return {str(row["button_id"]): int(row["click_count"] or 0) for row in rows}

    # ── 应用维度 ────────────────────────────────────────────────────────
    def apps_for_range(self, start_day: str, end_day: str, limit: int = 20) -> list[dict]:
        """``[{app_id, button_id, click_count, name}]``。**按 (应用, 按键) 给原样行**。

        折叠（合并应用）与排序在服务层做：``app_id`` 是合并前的成员，服务层才知道
        谁并进了谁。这里先按应用汇总给一个上限，避免把一个三百应用的库整份拉进内存。
        """
        rows = self._conn().execute(
            "SELECT m.app_id AS app_id, m.button_id AS button_id, "
            "       SUM(m.click_count) AS click_count, "
            "       COALESCE(a.user_alias, a.display_name) AS name "
            "FROM agg_mouse_app_day m LEFT JOIN app a ON a.id = m.app_id "
            "WHERE m.day_bucket BETWEEN ? AND ? "
            "GROUP BY m.app_id, m.button_id ORDER BY click_count DESC LIMIT ?",
            (start_day, end_day, limit * 5),
        )
        return [_app_row(row) for row in rows]

    def apps_total(self, limit: int = 20) -> list[dict]:
        rows = self._conn().execute(
            "SELECT m.app_id AS app_id, m.button_id AS button_id, "
            "       m.click_count AS click_count, "
            "       COALESCE(a.user_alias, a.display_name) AS name "
            "FROM agg_mouse_app_total m LEFT JOIN app a ON a.id = m.app_id "
            "ORDER BY click_count DESC LIMIT ?",
            (limit * 5,),
        )
        return [_app_row(row) for row in rows]

    # ── 时间分布 ────────────────────────────────────────────────────────
    def hours(self, start_day: str, end_day: str) -> dict[int, int]:
        """``小时 → 点击次数``（区间内所有天按小时汇总）。"""
        rows = self._conn().execute(
            "SELECT hour, SUM(click_count) AS click_count FROM agg_mouse_hour "
            "WHERE day_bucket BETWEEN ? AND ? GROUP BY hour",
            (start_day, end_day),
        )
        return {int(row["hour"]): int(row["click_count"] or 0) for row in rows}

    def days(self, start_day: str, end_day: str) -> dict[str, int]:
        """``日 → 点击次数``，升序由调用方按周期桶补齐（缺的日给 0 还是缺口由服务层定）。"""
        rows = self._conn().execute(
            "SELECT day_bucket, SUM(click_count) AS click_count FROM agg_mouse_button_day "
            "WHERE day_bucket BETWEEN ? AND ? GROUP BY day_bucket ORDER BY day_bucket",
            (start_day, end_day),
        )
        return {str(row["day_bucket"]): int(row["click_count"] or 0) for row in rows}

    # ── 总数 ────────────────────────────────────────────────────────────
    def total_range(self, start_day: str, end_day: str) -> int:
        row = self._conn().execute(
            "SELECT SUM(click_count) FROM agg_mouse_button_day "
            "WHERE day_bucket BETWEEN ? AND ?",
            (start_day, end_day),
        ).fetchone()
        return int(row[0] or 0)

    def total_all(self) -> int:
        row = self._conn().execute(
            "SELECT SUM(click_count) FROM agg_mouse_button_total"
        ).fetchone()
        return int(row[0] or 0)

    def active_days(self, start_day: str, end_day: str) -> int:
        """区间内有点击的日期数。「平均每天点多少」的分母，比"周期天数"诚实。"""
        row = self._conn().execute(
            "SELECT COUNT(DISTINCT day_bucket) FROM agg_mouse_button_day "
            "WHERE day_bucket BETWEEN ? AND ? AND click_count > 0",
            (start_day, end_day),
        ).fetchone()
        return int(row[0] or 0)


def _app_row(row) -> dict:
    return {
        "app_id": int(row["app_id"]),
        "button_id": str(row["button_id"]),
        "click_count": int(row["click_count"] or 0),
        "name": str(row["name"] or ""),
    }


__all__ = ["MouseRepository"]
