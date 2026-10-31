"""按键统计查询（M1 只做"够验证闭环"的量，M2 补齐 05 文档 §4 的全部端点）。

一条铁律贯穿本文件：**任何常规查询都不扫 `raw_key_events_*`**（01 文档 §4.1）。
下面每个方法都只碰 ``agg_*``，主键点查或范围扫。允许扫原始表的是两条**显式的回放路径**
（``replay_day`` 与 ``press_stream``），都带时间窗与 ``LIMIT``，且只服务动画。
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, tzinfo
from sqlite3 import Connection, DatabaseError

from .. import schema
from ..database import Database

_GRAIN_TABLES = {
    "day": "agg_key_day",
    "month": "agg_key_month",
    "year": "agg_key_year",
}


class KeyRepository:
    __slots__ = ("_db",)

    def __init__(self, db: Database) -> None:
        self._db = db

    def _conn(self) -> Connection:
        return self._db.connect()

    def heatmap(self, *, grain: str = "day", bucket: str | None = None) -> dict[str, dict]:
        """某个桶的键盘热力数据。``grain='total'`` 时忽略 ``bucket``。"""
        if grain == "total":
            rows = self._conn().execute(
                "SELECT key_id, press_count, duration_total_ms, duration_max_ms "
                "FROM agg_key_total"
            )
        else:
            table = _GRAIN_TABLES.get(grain)
            if table is None:
                raise ValueError(f"未知的粒度：{grain!r}")
            rows = self._conn().execute(
                f"SELECT key_id, press_count, duration_total_ms, duration_max_ms "
                f"FROM {table} WHERE bucket = ?",
                (bucket,),
            )
        return {row["key_id"]: _metrics(row) for row in rows}

    def range_heatmap(self, start_day: str, end_day: str) -> dict[str, dict]:
        """按日期区间聚合（周视图与自定义区间走这里，沿用 KeyTrace 的判断）。"""
        rows = self._conn().execute(
            "SELECT key_id, SUM(press_count) AS press_count, "
            "SUM(duration_total_ms) AS duration_total_ms, "
            "MAX(duration_max_ms) AS duration_max_ms "
            "FROM agg_key_day WHERE bucket BETWEEN ? AND ? GROUP BY key_id",
            (start_day, end_day),
        )
        return {row["key_id"]: _metrics(row) for row in rows}

    def app_heatmap(self, app_id: int) -> dict[str, dict]:
        """★ 某应用的键盘热力图：**一次主键范围查**。

        旧 KeyTrace 走的是"HTTP 取该应用全部历史区间 → 区间合并 → 按月分组 → 对每个
        区间在原始表上做范围扫 → Python 侧逐行累加"，复杂度 O(区间数 × 区间内事件数)。
        这里是 O(该应用活跃键数)，通常 ≤ 118 行。
        """
        rows = self._conn().execute(
            "SELECT key_id, press_count, duration_total_ms, duration_max_ms "
            "FROM agg_app_key_total WHERE app_id = ?",
            (app_id,),
        )
        return {row["key_id"]: _metrics(row) for row in rows}

    def app_heatmap_range(self, app_id: int, start_day: str, end_day: str) -> dict[str, dict]:
        """带日期区间的应用热力图——合并之后才可能存在的能力。"""
        rows = self._conn().execute(
            "SELECT key_id, SUM(press_count) AS press_count, "
            "SUM(duration_total_ms) AS duration_total_ms, "
            "MAX(duration_max_ms) AS duration_max_ms "
            "FROM agg_key_app_day WHERE app_id = ? AND day_bucket BETWEEN ? AND ? "
            "GROUP BY key_id",
            (app_id, start_day, end_day),
        )
        return {row["key_id"]: _metrics(row) for row in rows}

    def apps_for_key(self, key_id: str, limit: int = 10) -> list[dict]:
        """★ 反向查询：某个键主要被哪些应用按。合并前完全无法回答。"""
        rows = self._conn().execute(
            "SELECT app_id, SUM(press_count) AS press_count "
            "FROM agg_key_app_day WHERE key_id = ? GROUP BY app_id "
            "ORDER BY press_count DESC LIMIT ?",
            (key_id, limit),
        )
        return [
            {"app_id": int(row["app_id"]), "press_count": int(row["press_count"])}
            for row in rows
        ]

    def hourly(self, day: str) -> list[dict]:
        rows = self._conn().execute(
            "SELECT hour, SUM(press_count) AS press_count, "
            "SUM(duration_total_ms) AS duration_total_ms "
            "FROM agg_key_hour WHERE day_bucket = ? GROUP BY hour ORDER BY hour",
            (day,),
        )
        return [
            {
                "hour": int(row["hour"]),
                "press_count": int(row["press_count"]),
                "duration_total_ms": float(row["duration_total_ms"]),
            }
            for row in rows
        ]

    #: 一天回放最多取这么多条按下。正常人一天的按键上限远低于此；超过它几乎只可能来自
    #: 卡键或自动化脚本，而那类输入没有逐次回放的价值。截断时如实标记，不假装放完了。
    REPLAY_LIMIT = 20_000

    def replay_day(self, day: str, tz: tzinfo | None = None) -> dict | None:
        """某一天的有序按下序列，带相对当天 0 点的毫秒偏移与**按住时长**。

        这是**唯一允许按天扫一次性原始事件表的读路径**（01 文档 §4.1 的例外），因此
        它必须能撑住最坏情况：加 ``LIMIT`` 与升序索引 ``idx_rke_*_down`` 走同一条路，
        超出的部分直接不取。

        每条事件带 ``d``（这一次按了多久，毫秒）。**不加它，回放只能画固定时长的脉冲**：
        真实的输入里 40ms 与 200ms 是两种手感，而"打字"与"闪灯"的差别正在这里。时长在
        采集时已经算好并落在原始表里（``raw_key_events.duration_ms``），这里只是把它
        读出来——回放是唯一会用到它、也是唯一允许读原始表的地方。

        ``summary`` 是**这一份序列自己的账**，不是当天聚合表的总数：序列被 ``LIMIT``
        截断时（见 ``truncated``），"放了多少、按住多久"要和画面上真的放出来的次数对得上。

        返回 ``None`` 表示那个月的原始表不存在（``store_raw_key_events`` 关闭，或那个
        月没有数据）——调用方据此回 ``available: false``，而不是一张空的序列。
        """
        try:
            table = schema.raw_table_name(day[:7])
            midnight = datetime.fromisoformat(day)
        except (ValueError, TypeError):
            return None
        midnight = midnight.replace(tzinfo=tz) if tz else midnight.astimezone()
        start_ns = int(midnight.timestamp() * 1_000_000_000)
        end_ns = int((midnight + timedelta(days=1)).timestamp() * 1_000_000_000)
        conn = self._conn()
        exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
        ).fetchone()
        if exists is None:
            return None
        try:
            rows = conn.execute(
                f"SELECT key_id, down_ts_ns, duration_ms FROM {table} "
                "WHERE down_ts_ns >= ? AND down_ts_ns < ? "
                "ORDER BY down_ts_ns, id LIMIT ?",
                (start_ns, end_ns, self.REPLAY_LIMIT + 1),
            ).fetchall()
        except DatabaseError:
            return None
        truncated = len(rows) > self.REPLAY_LIMIT
        rows = rows[: self.REPLAY_LIMIT]
        events = [
            {
                "key_id": str(row["key_id"]),
                # 毫秒偏移。整数足够——回放的节奏误差远粗于 1ms，浮点只会让载荷变大。
                "t": int((int(row["down_ts_ns"]) - start_ns) // 1_000_000),
                # 按住时长，同样取整到毫秒。前端拿它决定键帽压下去停多久。
                "d": max(0, int(round(float(row["duration_ms"] or 0)))),
            }
            for row in rows
        ]
        held_ms = sum(event["d"] for event in events)
        return {
            "events": events,
            "summary": {
                "presses": len(events),
                # 累计按住时长：这些按下各自持续了多久之和，**不是**"从第一次到最后一次"的跨度。
                "held_ms": held_ms,
                "duration_avg_ms": round(held_ms / len(events), 1) if events else 0.0,
                "duration_max_ms": max((event["d"] for event in events), default=0),
                "active_keys": len({event["key_id"] for event in events}),
            },
            "truncated": truncated,
            "limit": self.REPLAY_LIMIT,
        }

    #: 时间流逝一次最多读这么多条按下。两年历史 × 一年 500 万次的话，这个上限会在
    #: 数据量爆炸前先拦住请求——截断标记随载荷回给前端，界面写明"只放了一部分"。
    PRESS_STREAM_LIMIT = 2_000_000

    def raw_months(self) -> list[str]:
        """库里实际存在的原始事件月份（``YYYY-MM``，升序）。

        「时间流逝」默认从最早一个月开跑。用 ``sqlite_master`` 而不是 ``Partitions``：
        后者带内存缓存，而这里只需要一次只读清单。
        """
        rows = self._conn().execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' "
            "AND name LIKE 'raw_key_events_%' ORDER BY name"
        ).fetchall()
        months: list[str] = []
        for row in rows:
            name = str(row["name"])
            suffix = name.removeprefix("raw_key_events_")
            if len(suffix) == 7 and suffix[4] == "_":
                months.append(suffix.replace("_", "-"))
        return months

    def press_stream(
        self,
        start_day: str,
        end_day: str,
        *,
        tz: tzinfo | None = None,
        limit: int = PRESS_STREAM_LIMIT,
    ) -> dict | None:
        """区间内的**逐次按下**，按时间升序，供时间流逝动画逐条累加。

        与 :meth:`replay_day` 同一个例外（01 文档 §4.1）：这是允许扫原始表的第二条
        读路径，同样带 ``LIMIT`` 并走 ``idx_rke_*_down``。区别是它跨月：按月表逐段查，
        月表本身按时间切开，拼接后仍然全局有序，不需要在内存里再排一次。

        返回 ``None`` 表示**一条原始表都没有**（``store_raw_key_events`` 关着，或从没
        写过）——调用方据此回 ``available: false``。月份存在但区间内没有按下时返回
        空序列，那是"这段没敲键盘"，不是"功能不可用"。
        """
        try:
            start = date.fromisoformat(start_day)
            end = date.fromisoformat(end_day)
        except (ValueError, TypeError):
            return None
        if end < start:
            return None
        start_midnight = datetime.combine(start, datetime.min.time())
        end_midnight = datetime.combine(end + timedelta(days=1), datetime.min.time())
        if tz is not None:
            start_midnight = start_midnight.replace(tzinfo=tz)
            end_midnight = end_midnight.replace(tzinfo=tz)
        start_ns = int(start_midnight.timestamp() * 1_000_000_000)
        end_ns = int(end_midnight.timestamp() * 1_000_000_000)

        conn = self._conn()
        existing = set(self.raw_months())
        events: list[tuple[str, int]] = []
        truncated = False
        cursor = start.replace(day=1)
        while cursor <= end:
            month = cursor.strftime("%Y-%m")
            if month in existing:
                table = schema.raw_table_name(month)
                try:
                    rows = conn.execute(
                        f"SELECT key_id, down_ts_ns FROM {table} "
                        "WHERE down_ts_ns >= ? AND down_ts_ns < ? "
                        "ORDER BY down_ts_ns, id LIMIT ?",
                        (start_ns, end_ns, limit - len(events) + 1),
                    ).fetchall()
                except DatabaseError:
                    rows = []
                for row in rows:
                    events.append((str(row["key_id"]), int(row["down_ts_ns"])))
                if len(events) > limit:
                    truncated = True
                    events = events[:limit]
                    break
            # 下个月一号。+32 天再归到 1 号，避开各月天数差异。
            cursor = (cursor + timedelta(days=32)).replace(day=1)
        if not existing:
            return None
        return {"events": events, "truncated": truncated, "limit": limit}

    def press_total(self) -> int:
        row = self._conn().execute("SELECT SUM(press_count) FROM agg_key_total").fetchone()
        return int(row[0] or 0)

    def top_keys(self, limit: int = 10) -> list[dict]:
        rows = self._conn().execute(
            "SELECT key_id, press_count, duration_total_ms, duration_max_ms "
            "FROM agg_key_total ORDER BY press_count DESC LIMIT ?",
            (limit,),
        )
        return [{"key_id": row["key_id"], **_metrics(row)} for row in rows]

    # ── M2：周期查询 ────────────────────────────────────────────────────
    def metrics_for_range(
        self, start_day: str, end_day: str, *, app_id: int | None = None
    ) -> dict[str, dict]:
        """周期内的键盘指标。给 ``app_id`` 就走 ``agg_key_app_day``。

        **``app_id`` 这个参数是合并的最大收益点**：旧 KeyTrace 要先 HTTP 向 TimeLens 取
        该进程的全部前台区间，合并成不重叠区间列表，再按月分组、对每个区间在原始事件表
        上做范围扫、最后在 Python 里逐行累加——O(区间数 × 区间内事件数)。这里是一次
        范围扫，结果最多 118 行。
        """
        if app_id is None:
            return self.range_heatmap(start_day, end_day)
        return self.app_heatmap_range(app_id, start_day, end_day)

    def metrics_total(self, *, app_id: int | None = None) -> dict[str, dict]:
        if app_id is None:
            return self.heatmap(grain="total")
        return self.app_heatmap(app_id)

    def bucket_metrics(
        self, grain: str, start: str, end: str, *, app_id: int | None = None
    ) -> dict[str, dict]:
        """时间线的桶 → 指标。``grain`` ∈ ``day`` | ``month`` | ``year``。

        限定应用时只有 ``agg_key_app_day`` 这一份日粒度事实，月/年桶由它现场汇总——
        为"应用 × 键 × 月"再建两张表并不划算：一年只有 12 个桶，汇总 365 行的代价
        比多两张表的写入代价低。
        """
        if app_id is None:
            table = _GRAIN_TABLES.get(grain)
            if table is None:
                raise ValueError(f"未知的粒度：{grain!r}")
            rows = self._conn().execute(
                f"SELECT bucket, SUM(press_count) AS press_count, "
                f"SUM(duration_total_ms) AS duration_total_ms, "
                f"MAX(duration_max_ms) AS duration_max_ms "
                f"FROM {table} WHERE bucket BETWEEN ? AND ? GROUP BY bucket",
                (start, end),
            )
        else:
            length = {"day": 10, "month": 7, "year": 4}.get(grain)
            if length is None:
                raise ValueError(f"未知的粒度：{grain!r}")
            rows = self._conn().execute(
                "SELECT SUBSTR(day_bucket, 1, ?) AS bucket, "
                "SUM(press_count) AS press_count, "
                "SUM(duration_total_ms) AS duration_total_ms, "
                "MAX(duration_max_ms) AS duration_max_ms "
                "FROM agg_key_app_day WHERE app_id = ? AND day_bucket BETWEEN ? AND ? "
                "GROUP BY bucket",
                (length, app_id, start, end),
            )
        return {row["bucket"]: _metrics(row) for row in rows}

    def hourly_metrics(
        self, start_day: str, end_day: str, *, key_id: str | None = None
    ) -> dict[int, dict]:
        """24 小时分布（"我一般几点在敲键盘"）。旧版扫当月原始事件表再在 Python 里分桶。

        **两张表，按需要按不按键分**：不限定按键时读 ``agg_press_hour``（键无关，三年
        26k 行）；限定某个键时读 ``agg_key_hour`` 并走 ``idx_agg_key_hour_key``。同一个
        事实在 ``agg_key_hour`` 里按键拆开存，不限定按键还去读它意味着扫三年 2.9M 行
        （实测 200ms，是 M2 基准里最大的单项开销）。
        """
        if key_id is None:
            rows = self._conn().execute(
                "SELECT hour, SUM(press_count) AS press_count, "
                "SUM(duration_total_ms) AS duration_total_ms, 0 AS duration_max_ms "
                "FROM agg_press_hour WHERE day_bucket BETWEEN ? AND ? GROUP BY hour",
                (start_day, end_day),
            )
        else:
            rows = self._conn().execute(
                "SELECT hour, SUM(press_count) AS press_count, "
                "SUM(duration_total_ms) AS duration_total_ms, 0 AS duration_max_ms "
                "FROM agg_key_hour WHERE key_id = ? AND day_bucket BETWEEN ? AND ? "
                "GROUP BY hour",
                (key_id, start_day, end_day),
            )
        return {int(row["hour"]): _metrics(row) for row in rows}

    def apps_for_key_range(
        self, key_id: str, start_day: str, end_day: str, limit: int = 20
    ) -> list[dict]:
        """★ 反向视图：某个键在这段时间主要被哪些应用按。合并前完全无法回答。"""
        rows = self._conn().execute(
            "SELECT app_id, SUM(press_count) AS press_count, "
            "SUM(duration_total_ms) AS duration_total_ms "
            "FROM agg_key_app_day WHERE key_id = ? AND day_bucket BETWEEN ? AND ? "
            "GROUP BY app_id ORDER BY press_count DESC LIMIT ?",
            (key_id, start_day, end_day, limit),
        )
        return [
            {
                "app_id": int(row["app_id"]),
                "press_count": int(row["press_count"] or 0),
                "duration_total_ms": float(row["duration_total_ms"] or 0.0),
            }
            for row in rows
        ]

    def app_key_totals(self, start_day: str, end_day: str) -> dict[int, dict[str, int]]:
        """``app_id`` → ``{key_id: press_count}``，一次查完整个周期。

        洞察面板要为十几个应用各取 Top 键，逐个应用发一次查询就是 N+1。
        """
        rows = self._conn().execute(
            "SELECT app_id, key_id, SUM(press_count) AS press_count "
            "FROM agg_key_app_day WHERE day_bucket BETWEEN ? AND ? "
            "GROUP BY app_id, key_id",
            (start_day, end_day),
        )
        result: dict[int, dict[str, int]] = {}
        for row in rows:
            result.setdefault(int(row["app_id"]), {})[row["key_id"]] = int(row["press_count"] or 0)
        return result

    def app_key_totals_all_time(self) -> dict[int, dict[str, int]]:
        rows = self._conn().execute(
            "SELECT app_id, key_id, press_count FROM agg_app_key_total"
        )
        result: dict[int, dict[str, int]] = {}
        for row in rows:
            result.setdefault(int(row["app_id"]), {})[row["key_id"]] = int(row["press_count"] or 0)
        return result

    # ── M2：分钟级（``peak_kpm`` 与 ``active_hours`` 的唯一来源）───────────
    def minute_peak(self, start_day: str, end_day: str) -> dict | None:
        """峰值 KPM 及其发生的那一分钟。

        小时聚合只能给出"某小时的平均 KPM"，把平均值叫成峰值是在编数据——
        ``agg_press_minute`` 就是为这个字段存在的（05 文档 §5）。
        """
        row = self._conn().execute(
            "SELECT day_bucket, minute, press_count FROM agg_press_minute "
            "WHERE day_bucket BETWEEN ? AND ? ORDER BY press_count DESC, day_bucket, minute "
            "LIMIT 1",
            (start_day, end_day),
        ).fetchone()
        if row is None or not row["press_count"]:
            return None
        return {
            "day": row["day_bucket"],
            "minute": int(row["minute"]),
            "press_count": int(row["press_count"]),
        }

    def minute_bounds(self, start_day: str, end_day: str) -> tuple[int | None, int | None]:
        """周期内**最早与最晚的活跃时刻**（当日分钟序号 0–1439），供 ``active_hours`` 用。

        取的是"一天中的哪一分钟"而不是"哪一天的哪一分钟"：跨多天时用户想知道的是
        "我一般 9:12 开始、23:41 结束"，而不是区间首日的第一次按键。单日周期下两者等价。
        """
        row = self._conn().execute(
            "SELECT MIN(minute), MAX(minute) FROM agg_press_minute "
            "WHERE day_bucket BETWEEN ? AND ? AND press_count > 0",
            (start_day, end_day),
        ).fetchone()
        if row is None or row[0] is None:
            return (None, None)
        return (int(row[0]), int(row[1]))

    def presses_in_day_minutes(self, day: str, start_minute: int, end_minute: int) -> int:
        """某天 ``[start_minute, end_minute]`` 之间的按键数（闭区间）。

        专注时段的按键量由此得出：一次访问期间前台始终是同一个应用，因此"这段时间的
        按键总数"就是"这个应用在这段时间的按键数"。边界那一分钟整格计入——分钟是我们
        存的最细粒度，为了几秒的精度去扫原始事件不值当（05 文档 §5）。
        """
        row = self._conn().execute(
            "SELECT SUM(press_count) FROM agg_press_minute "
            "WHERE day_bucket = ? AND minute BETWEEN ? AND ?",
            (day, start_minute, end_minute),
        ).fetchone()
        return int(row[0] or 0)

    def press_total_range(self, start_day: str, end_day: str) -> int:
        row = self._conn().execute(
            "SELECT SUM(press_count) FROM agg_key_day WHERE bucket BETWEEN ? AND ?",
            (start_day, end_day),
        ).fetchone()
        return int(row[0] or 0)

    def active_key_count(self, start_day: str, end_day: str) -> int:
        row = self._conn().execute(
            "SELECT COUNT(DISTINCT key_id) FROM agg_key_day "
            "WHERE bucket BETWEEN ? AND ? AND press_count > 0",
            (start_day, end_day),
        ).fetchone()
        return int(row[0] or 0)

def _metrics(row) -> dict:
    total = float(row["duration_total_ms"] or 0.0)
    count = int(row["press_count"] or 0)
    return {
        "press_count": count,
        "duration_total_ms": total,
        # 平均值在这里算而不是让前端算：分母为 0 的路径只该存在一处。
        "duration_avg_ms": (total / count) if count else 0.0,
        "duration_max_ms": float(row["duration_max_ms"] or 0.0),
    }


__all__ = ["KeyRepository"]
