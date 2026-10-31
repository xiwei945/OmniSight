"""逐次按键流（P1：键盘时间流逝动画的数据面）。

**为什么不是一天的 ``/keyboard/replay`` 复用一个接口**：那个接口是给人按天回放用的，
一次只取一张月表；时间流逝要把两三个月、几十万次按下按时间顺序喂给动画。JSON 对象
数组在这个量级上是 12 MB 起步，浏览器光解析就要几百毫秒，所以这里做两件事：

1. **只传两张紧凑的二进制流**：时间用 LEB128 变长增量、键用下标（``uint8``/``uint16``），
   各 base64 一次。86.7 万次按下约 2.4 MB（原样 JSON 的 1/5），本机 HTTP 上是几十毫秒。
2. **日期边界由服务端算**：前端不碰时区。"第 N 天"与日期标签直接用这份 ``days``，
   免得浏览器与数据库在夏令时、跨零点上的口径不一致。

编码是纯函数（``encode_events``），解码在 ``frontend/src/core/press-stream.ts``，
两边用同一套 LEB128 约定；``tests/unit/test_press_stream.py`` 做往返验证。
"""

from __future__ import annotations

import base64
from collections.abc import Sequence

#: 键下标超过这个数才升到两字节。104 键的布局远用不到，留出孤儿键（换过键盘的历史）。
_UINT8_KEYS = 256


def _encode_varint(value: int, out: bytearray) -> None:
    """无符号 LEB128。增量恒为非负，所以不需要 ZigZag。"""
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return


def decode_varint(data: bytes, index: int = 0) -> tuple[int, int]:
    """读一个 LEB128，返回 ``(值, 下一个位置)``。测试与排障用，生产路径在前端。"""
    result = 0
    shift = 0
    while True:
        byte = data[index]
        index += 1
        result |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return result, index
        shift += 7


def decode_times(payload: bytes, count: int) -> list[int]:
    """把 ``times`` 流还原成绝对毫秒偏移序列。仅测试使用。"""
    values: list[int] = []
    index = 0
    total = 0
    for _ in range(count):
        delta, index = decode_varint(payload, index)
        total += delta
        values.append(total)
    return values


def encode_events(
    events: Sequence[tuple[str, int]],
    *,
    start_ms: int,
) -> dict[str, object]:
    """``[(key_id, down_ts_ns), …]``（**已按时间升序**）→ 两张二进制流。

    ``start_ms`` 是区间起点（Unix 毫秒）：所有偏移相对它，首条事件的增量就是它自己的
    偏移，所以整条流只有加法，前端游标可以边扫边累加。
    """
    keys = sorted({key_id for key_id, _ in events})
    lookup = {key_id: index for index, key_id in enumerate(keys)}
    width = 1 if len(keys) <= _UINT8_KEYS else 2

    times = bytearray()
    indices = bytearray()
    previous = 0
    for key_id, down_ts_ns in events:
        offset = int(down_ts_ns) // 1_000_000 - start_ms
        # 时间戳可能在同一毫秒里重复，增量 0 是合法的。
        _encode_varint(max(0, offset - previous), times)
        previous = max(previous, offset)
        index = lookup[key_id]
        if width == 1:
            indices.append(index & 0xFF)
        else:
            indices.extend((index & 0xFF, (index >> 8) & 0xFF))

    return {
        "keys": keys,
        "index_width": width,
        "times": base64.b64encode(bytes(times)).decode("ascii"),
        "indices": base64.b64encode(bytes(indices)).decode("ascii"),
        "count": len(events),
    }
