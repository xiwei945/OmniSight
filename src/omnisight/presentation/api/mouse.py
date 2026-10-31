"""鼠标接口（05 文档 §4 的键盘面板同构）。

只有一个端点：``/api/v1/mouse`` 一次返回概览、按键分布、应用排行、小时分布、逐日/逐月
趋势与键鼠比。**为什么不拆成五个**——它们来自同一批聚合行，拆开就是五次往返去算同一
件事；而面板里五张卡永远一起出现，没有"只看应用排行"的独立入口（与 ``/overview``
合成 8 个旧请求是同一条理由）。

参数只有周期（``range`` / ``date`` / ``start`` / ``end``）：鼠标这一版没有应用范围过滤，
也没有指标切换（只有一个指标）。
"""

from __future__ import annotations

from typing import Any

from flask import Flask, jsonify, request

from . import envelope, resolved_period


def register(app: Flask, context: Any) -> None:
    @app.get("/api/v1/mouse")
    def mouse_summary():
        period = resolved_period(context, request.args)
        payload = context.services.mouse.summary(period)
        return jsonify({**envelope(context, period), **payload})


__all__ = ["register"]
