"""键盘接口（05 文档 §4）。

``/keyboard/layout`` 是布局的唯一真源：前端不内置任何键位坐标。请求一个尚未实现的
布局族返回 400 并列出可选值——静默换成别的族会让"我明明选了 ISO"变成一个无法排查的
问题。
"""

from __future__ import annotations

from typing import Any

from flask import Flask, jsonify, request

from ...capture import layouts
from ..errors import ApiError
from ..validators import parse_app_id, parse_key_id, parse_metric, parse_period, parse_views
from . import envelope, resolved_period


def register(app: Flask, context: Any) -> None:
    @app.get("/api/v1/keyboard/layout")
    def keyboard_layout():
        requested = (request.args.get("family") or "").strip() or None
        try:
            payload = context.services.keyboard.layout(requested)
        except ValueError as exc:
            raise ApiError(
                "尚未实现的键盘布局族，可选："
                f"{'、'.join(layouts.IMPLEMENTED_FAMILIES)}",
                code="invalid_param",
                field="family",
                extra={"requested": str(exc)},
            ) from exc
        return jsonify(payload)

    @app.get("/api/v1/keyboard/heatmap")
    def keyboard_heatmap():
        period = resolved_period(context, request.args)
        payload = context.services.keyboard.heatmap(
            period,
            metric=parse_metric(request.args),
            app_id=parse_app_id(request.args),
        )
        warnings = payload.pop("warnings", [])
        return jsonify({**envelope(context, period, warnings=warnings), **payload})

    @app.get("/api/v1/keyboard/timeline")
    def keyboard_timeline():
        anchor = parse_period(request.args)
        payload = context.services.keyboard.timeline(
            parse_views(request.args),
            anchor=anchor,
            metric=parse_metric(request.args),
            app_id=parse_app_id(request.args),
        )
        warnings = payload.pop("warnings", [])
        return jsonify({**envelope(context, warnings=warnings), **payload})

    @app.get("/api/v1/keyboard/replay")
    def keyboard_replay():
        day = (request.args.get("date") or context.services.context.today().isoformat()).strip()
        try:
            from datetime import date

            date.fromisoformat(day)
        except ValueError as exc:
            raise ApiError("日期格式应为 YYYY-MM-DD", code="invalid_param", field="date") from exc
        payload = context.services.keyboard.replay_day(day)
        if payload is None:
            return jsonify(
                {
                    **envelope(context),
                    "available": False,
                    "events": [],
                    # 形状恒定：拿不到序列的位置也给 summary，前端不必为"有没有这个键"分叉。
                    "summary": None,
                    "truncated": False,
                    "limit": 0,
                }
            )
        return jsonify({**envelope(context), "available": True, **payload})

    @app.get("/api/v1/keyboard/press-stream")
    def keyboard_press_stream():
        """逐次按键流：时间流逝动画的数据面（见 services/press_stream.py）。

        默认区间是"库里最早的原始月份 → 今天"，一次把整段拿到前端。不做分页：
        这个动画本来就要从头连放，分页会让"第 N 天"在换页时断掉。
        """
        from datetime import date

        to_day = (request.args.get("to") or context.services.context.today().isoformat()).strip()
        start_arg = (request.args.get("from") or "").strip()
        try:
            date.fromisoformat(to_day)
            if start_arg:
                date.fromisoformat(start_arg)
        except ValueError as exc:
            raise ApiError(
                "日期格式应为 YYYY-MM-DD", code="invalid_param", field="from"
            ) from exc
        if not start_arg:
            months = context.services.keyboard.raw_months()
            start_arg = f"{months[0]}-01" if months else to_day
        if start_arg > to_day:
            raise ApiError("from 不能晚于 to", code="invalid_param", field="from")
        payload = context.services.keyboard.press_stream(start_arg, to_day)
        if payload is None:
            # 形状恒定：原始事件没开时前端照常渲染，只是给一句说明。
            return jsonify(
                {
                    "available": False,
                    "from": start_arg,
                    "to": to_day,
                    "start_ms": 0,
                    "keys": [],
                    "index_width": 1,
                    "times": "",
                    "indices": "",
                    "count": 0,
                    "days": [],
                    "truncated": False,
                }
            )
        return jsonify(payload)

    @app.get("/api/v1/keyboard/keys/<key_id>")
    def keyboard_key(key_id: str):
        period = resolved_period(context, request.args)
        # app_id 与热力图同参：范围切到某个应用时，单键详情必须跟着走，否则热图与
        # 详情来自两个不同的口径而界面上没有提示（14 文档 §2.8）。
        payload = context.services.keyboard.key_detail(
            parse_key_id(key_id), period, parse_app_id(request.args)
        )
        return jsonify({**envelope(context, period), **payload})

    @app.get("/api/v1/keyboard/ergonomics")
    def keyboard_ergonomics():
        period = resolved_period(context, request.args)
        payload = context.services.keyboard.ergonomics(period, parse_app_id(request.args))
        return jsonify({**envelope(context, period), **payload})


__all__ = ["register"]
