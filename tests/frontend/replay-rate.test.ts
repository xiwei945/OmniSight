// 回放倍速的取值与显示。
//
// 倍速条本身没什么可测的，坏的是它两头的换算：滑条按 0.25 吸附、localStorage 里
// 可能躺着一个手写的数、读数要显示成 `1.5×` 而不是 `1.50×`。这几件事错了都不会报错，
// 只会在界面上显示一个"到不了"的档位。
//
// 还有一条容易踩的：**倍速不是 status 的一部分**。`stop()`/`pause()` 会重写整个
// state 对象，如果倍速跟着被抹回 1，用户每停一次回放就得重新调——所以这里断言它活着。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_RATE,
  MIN_RATE,
  RATE_STEP,
  clampRate,
  formatRate,
  getReplay,
  setRate,
  stop,
} from '../../frontend/src/core/replay.ts';

test('倍速夹在范围内并吸附到档距上', () => {
  assert.equal(clampRate(1), 1);
  assert.equal(clampRate(2.5), 2.5);
  // 滑条给不出这些值，但设置靠 localStorage 传过来，什么都可能进来。
  assert.equal(clampRate(0), MIN_RATE);
  assert.equal(clampRate(-3), MIN_RATE);
  assert.equal(clampRate(99), MAX_RATE);
  assert.equal(clampRate(Number.NaN), 1);
  assert.equal(clampRate(Number.POSITIVE_INFINITY), 1);
  // 吸附：取最近的档位，不向上取整（1.1 靠近 1，2.9 靠近 3）。
  assert.equal(clampRate(1.1), 1);
  assert.equal(clampRate(1.2), 1.25);
  assert.equal(clampRate(2.9), 3);
});

test('档距是端点能整除的一档', () => {
  // 端点必须落在档距上，否则滑条拉到最右会显示 3.99× 这种数。
  assert.equal((MAX_RATE - MIN_RATE) % RATE_STEP, 0);
});

test('读数：整数不带小数点，小数去掉末尾的 0', () => {
  assert.equal(formatRate(1), '1×');
  assert.equal(formatRate(4), '4×');
  assert.equal(formatRate(0.5), '0.5×');
  assert.equal(formatRate(0.75), '0.75×');
  assert.equal(formatRate(1.5), '1.5×');
  assert.equal(formatRate(1.25), '1.25×');
});

test('改倍速立刻写进状态，并且不再随 stop 归位', () => {
  assert.equal(getReplay().rate, 1);
  assert.equal(setRate(2), 2);
  assert.equal(getReplay().rate, 2);

  // 越界的输入照旧被夹回来，状态里不会留下 7。
  assert.equal(setRate(7), MAX_RATE);
  assert.equal(getReplay().rate, MAX_RATE);

  // 停掉回放 = 重写整个 state。倍速是播放习惯，不该被这次重写带走。
  stop();
  assert.equal(getReplay().status, 'idle');
  assert.equal(getReplay().rate, MAX_RATE);

  setRate(1);
  assert.equal(getReplay().rate, 1);
});
