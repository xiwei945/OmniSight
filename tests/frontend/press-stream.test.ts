// 逐次按键流的解码与游标：顺序、累计、跳转。
//
// 这三个东西坏了都不会报错，只会"看起来不对劲"：某天数字停住（时间解码错）、
// 某些键不亮（下标错位）、拖完进度条数字翻倍（seek 没清账）。所以断言到具体计数。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PressCursor,
  dayIndexAt,
  decodePressStream,
  terminalP95,
} from '../../frontend/src/core/press-stream.ts';
import type { PressStreamResponse } from '../../frontend/src/types/api.d.ts';

/** LEB128（与 services/press_stream.py 同一套）。 */
function varint(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  for (;;) {
    const byte = rest % 128;
    rest = Math.floor(rest / 128);
    if (rest) out.push(byte | 0x80);
    else {
      out.push(byte);
      return out;
    }
  }
}

function base64(bytes: number[]): string {
  return Buffer.from(bytes).toString('base64');
}

function payloadOf(overrides: Partial<PressStreamResponse> = {}): PressStreamResponse {
  // 三次按下：100ms、250ms、250ms（同一毫秒），键分别是 a、space、space。
  const times = [...varint(100), ...varint(150), ...varint(0)];
  return {
    available: true,
    from: '2026-09-03',
    to: '2026-09-04',
    start_ms: 1_790_000_000_000,
    keys: ['key_a', 'space'],
    index_width: 1,
    times: base64(times),
    indices: base64([0, 1, 1]),
    count: 3,
    days: [
      { date: '2026-09-03', at_ms: 0 },
      { date: '2026-09-04', at_ms: 86_400_000 },
    ],
    truncated: false,
    ...overrides,
  };
}

test('解码：时间冗余（同一毫秒）与键下标都还原', () => {
  const data = decodePressStream(payloadOf());
  assert.ok(data);
  assert.deepEqual(Array.from(data.times), [100, 250, 250]);
  assert.deepEqual(Array.from(data.indices), [0, 1, 1]);
  assert.equal(data.count, 3);
  assert.equal(data.spanMs, 86_400_000 + 86_400_000 - 0);
  assert.equal(data.p95, 2);
});

test('超过 2^31 的偏移不会被 32 位位运算截断', () => {
  // 90 天 = 7.776e9 ms，超过 int32 上限。用位移累加会变成负数，动画会倒着走。
  const data = decodePressStream(
    payloadOf({
      count: 2,
      times: base64([...varint(0), ...varint(7_776_000_000)]),
      indices: base64([0, 0]),
    }),
  );
  assert.ok(data);
  assert.deepEqual(Array.from(data.times), [0, 7_776_000_000]);
});

test('游标按顺序累计，不会越过当前时刻', () => {
  const data = decodePressStream(payloadOf());
  assert.ok(data);
  const cursor = new PressCursor(data);

  assert.equal(cursor.advanceTo(99), 0);
  assert.equal(cursor.total, 0);

  assert.equal(cursor.advanceTo(250), 3);
  assert.deepEqual(Array.from(cursor.counts), [1, 2]);
  assert.equal(cursor.total, 3);

  // 时间不倒退时不应重复累加。
  assert.equal(cursor.advanceTo(10_000), 0);
  assert.deepEqual(Array.from(cursor.counts), [1, 2]);
});

test('seek 会清账重放，不会把计数翻倍', () => {
  const data = decodePressStream(payloadOf());
  assert.ok(data);
  const cursor = new PressCursor(data);
  cursor.advanceTo(250);
  cursor.seek(100);
  assert.deepEqual(Array.from(cursor.counts), [1, 0]);
  assert.equal(cursor.total, 1);
  cursor.seek(250);
  assert.deepEqual(Array.from(cursor.counts), [1, 2]);
  assert.equal(cursor.total, 3);
});

test('第几天按天边界二分，不越界', () => {
  const data = decodePressStream(payloadOf());
  assert.ok(data);
  assert.equal(dayIndexAt(data, -1), 0);
  assert.equal(dayIndexAt(data, 0), 0);
  assert.equal(dayIndexAt(data, 50_000_000), 0);
  assert.equal(dayIndexAt(data, 86_400_000), 1);
  assert.equal(dayIndexAt(data, 999_999_999), 1);
});

test('游标记下最近放出的按键，新的在后，seek 清环', () => {
  const data = decodePressStream(payloadOf());
  assert.ok(data);
  const cursor = new PressCursor(data);
  assert.equal(cursor.recentCount, 0);

  cursor.advanceTo(250);
  assert.equal(cursor.recentCount, 3);
  const newest = (cursor.recentHead - 1 + cursor.recent.length) % cursor.recent.length;
  const lastThree = [0, 1, 2].map(
    (step) => cursor.recent[(newest - step + cursor.recent.length) % cursor.recent.length],
  );
  // 三次按下依次是 a、space、space，所以倒着读是 space、space、a。
  assert.deepEqual(lastThree, [1, 1, 0]);

  // 跳转之后环是空的：拿跳转前的手指去播按压动画会动错键。
  cursor.seek(100);
  assert.equal(cursor.recentCount, 0);
});

test('最近按键的环不会越写越长', () => {
  const total = 300;
  const times: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index < total; index += 1) {
    times.push(...varint(index === 0 ? 0 : 1));
    indices.push(0);
  }
  const data = decodePressStream(
    payloadOf({ count: total, times: base64(times), indices: base64(indices) }),
  );
  assert.ok(data);
  const cursor = new PressCursor(data);
  cursor.advanceTo(10_000);
  assert.equal(cursor.total, total);
  assert.equal(cursor.recentCount, cursor.recent.length);
});

test('终值 p95 只看按过的键', () => {
  const data = decodePressStream(payloadOf());
  assert.ok(data);
  assert.equal(terminalP95(data), 2);
});

test('不可用或空流返回 null', () => {
  assert.equal(decodePressStream(null), null);
  assert.equal(decodePressStream(payloadOf({ available: false })), null);
  assert.equal(decodePressStream(payloadOf({ count: 0 })), null);
});
