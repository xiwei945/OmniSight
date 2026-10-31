"""逐次按键流的编码：往返一致、顺序不变、下标宽度。

这条编码是动画的数据面，坏了的症状很安静：时间差一点 ↦ 某一天的数字停住不动；
下标错一位 ↦ 某个键永远不亮。所以断言到具体数值，而不只是"能解码"。
"""

from __future__ import annotations

import base64

from omnisight.services.press_stream import decode_times, encode_events


def _events(*pairs: tuple[str, int]) -> list[tuple[str, int]]:
    return list(pairs)


def test_times_round_trip_with_repeated_milliseconds():
    start_ms = 1_790_000_000_000
    events = _events(
        ("key_a", start_ms * 1_000_000 + 250_000_000),
        ("key_b", start_ms * 1_000_000 + 250_400_000),  # 同一毫秒
        ("space", start_ms * 1_000_000 + 1_500_000_000),
    )
    encoded = encode_events(events, start_ms=start_ms)
    times = decode_times(base64.b64decode(encoded["times"]), encoded["count"])
    assert times == [250, 250, 1500]


def test_indices_follow_the_sorted_key_table():
    start_ms = 0
    events = _events(
        ("space", 1_000_000),
        ("key_a", 2_000_000),
        ("space", 3_000_000),
    )
    encoded = encode_events(events, start_ms=start_ms)
    assert encoded["keys"] == ["key_a", "space"]
    assert encoded["index_width"] == 1
    indices = list(base64.b64decode(encoded["indices"]))
    assert indices == [1, 0, 1]


def test_more_than_256_keys_switch_to_uint16():
    start_ms = 0
    events = [(f"key_{index}", (index + 1) * 1_000_000) for index in range(300)]
    encoded = encode_events(events, start_ms=start_ms)
    assert encoded["index_width"] == 2
    raw = base64.b64decode(encoded["indices"])
    assert len(raw) == 600
    # 下标是**排序后**的位置，不是 key_id 里的数字：`key_299` 在字典序里排在 `key_29` 之后。
    expected = encoded["keys"].index("key_299")
    assert raw[-2:] == bytes((expected & 0xFF, (expected >> 8) & 0xFF))


def test_empty_stream_stays_a_valid_payload():
    encoded = encode_events([], start_ms=0)
    assert encoded["count"] == 0
    assert encoded["keys"] == []
    assert base64.b64decode(encoded["times"]) == b""
    assert base64.b64decode(encoded["indices"]) == b""
