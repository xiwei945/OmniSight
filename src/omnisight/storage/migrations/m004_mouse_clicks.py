"""鼠标点击统计的表（schema v4）。

v1–v3 只有键盘与屏幕时间。鼠标点击是**新增的一类事实**，不是原有表的又一种切法，
因此是五张新表而不是给 ``agg_key_*`` 加一列：

* ``agg_mouse_button_day`` / ``agg_mouse_button_total`` —— 按键维度的点击次数；
* ``agg_mouse_app_day`` / ``agg_mouse_app_total`` —— 应用 × 按键（"右键主要点在哪些
  应用里"这种问题只有它是 O(行数) 的）；
* ``agg_mouse_hour`` —— 一天里的分布。

**不回填历史数据。** v3 及以前根本没有鼠标事件可回填，这些天的点击计数就是 0；
界面上的「鼠标」面板只按有数据的日期给结论，不会把"升级前没采集"说成"那几天没点鼠标"。

DDL 的真源仍在 ``storage/schema.py``（本项目所有建表语句都只有那一份），这里只是
把新表补进已经存在的库。``create_schema`` 用 ``IF NOT EXISTS``，因此全新库由 m001
一次建成，本迁移对它是空操作——与 m002 同一个手法。
"""

from __future__ import annotations

import logging
from sqlite3 import Connection

from .. import schema

logger = logging.getLogger(__name__)

ADDED_TABLES: tuple[str, ...] = (
    schema.AGG_MOUSE_BUTTON_DAY_DDL,
    schema.AGG_MOUSE_BUTTON_TOTAL_DDL,
    schema.AGG_MOUSE_APP_DAY_DDL,
    schema.AGG_MOUSE_APP_TOTAL_DDL,
    schema.AGG_MOUSE_HOUR_DDL,
)


def up(conn: Connection) -> None:
    """幂等：表已存在时什么都不做。"""
    for ddl in ADDED_TABLES:
        conn.execute(ddl)
    # 新增的两条索引在 schema.INDEXES 里（IF NOT EXISTS），重放一遍即可补上。
    for ddl in schema.INDEXES:
        conn.execute(ddl)
    logger.info("迁移 004：鼠标点击统计表已就绪")


__all__ = ["ADDED_TABLES", "up"]
