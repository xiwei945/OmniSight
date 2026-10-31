// 「播放今天」的累加：四个 metric 都要能从 0 涨起，而且色阶分母要和热力图同一条规则。
//
// 坏了不会报错，只会"看起来不对"：次数涨了但总时长不动（d 没读到）、暂停后继续时数字
// 翻倍（重播没清零）、某个键的颜色和热力图对不上（p95 两套算法）。所以断言到具体数字。
import assert from 'node:assert/strict';
import test from 'node:test';
import { p95OfCounts } from '../../frontend/src/core/counts.ts';
import {
  p95OfMetric,
  tally,
  valueOfMetric,
} from '../../frontend/src/core/replay-counts.ts';
import type { ReplayEventLike } from '../../frontend/src/core/replay-counts.ts';

function events(): ReplayEventLike[] {
  // a 按了 3 次（40/60/80ms），space 两次（100/300ms），b 一次（20ms）。
  return [
    { key_id: 'key_a', d: 40 },
    { key_id: 'space', d: 100 },
    { key_id: 'key_a', d: 60 },
    { key_id: 'key_b', d: 20 },
    { key_id: 'space', d: 300 },
    { key_id: 'key_a', d: 80 },
  ];
}

test('累加：次数、总时长、最长', () => {
  const { totals, events: count } = tally(events());
  assert.equal(count, 6);
  assert.deepEqual(totals.get('key_a'), { count: 3, sumMs: 180, maxMs: 80 });
  assert.deepEqual(totals.get('space'), { count: 2, sumMs: 400, maxMs: 300 });
  assert.deepEqual(totals.get('key_b'), { count: 1, sumMs: 20, maxMs: 20 });
});

test('四个 metric 各自的读数', () => {
  const { totals } = tally(events());
  const a = totals.get('key_a');
  assert.ok(a);
  assert.equal(valueOfMetric('press_count', a), 3);
  assert.equal(valueOfMetric('duration_total_ms', a), 180);
  assert.equal(valueOfMetric('duration_avg_ms', a), 60); // 180 / 3
  assert.equal(valueOfMetric('duration_max_ms', a), 80);
  // 未知 id 退回次数：宁可显示一个能读的数字，也不要键面空着。
  assert.equal(valueOfMetric('whatever', a), 3);
});

test('缺 d 的老数据只影响时长，不影响次数', () => {
  const { totals } = tally([{ key_id: 'key_x' }, { key_id: 'key_x', d: 50 }]);
  const x = totals.get('key_x');
  assert.ok(x);
  assert.equal(x.count, 2);
  assert.equal(x.sumMs, 50);
  assert.equal(x.maxMs, 50);
});

test('空事件不产生任何键', () => {
  const { totals, events: count } = tally([]);
  assert.equal(count, 0);
  assert.equal(totals.size, 0);
  // 色阶分母退回 1，调用方不必再判空（除零会把颜色算成 NaN，整块键盘发黑）。
  assert.equal(p95OfMetric('press_count', tally([])), 1);
});

test('色阶分母是终值的 p95，不是最大值', () => {
  const { totals } = tally(events());
  // 次数：1、2、3 -> p95 落在最大值（3 个点太少，分位取到最后一个）
  assert.equal(p95OfMetric('press_count', { totals, events: 6 }), 3);
  // 时长：a=180、space=400、b=20 -> 排序 20、180、400，p95 仍是 400
  assert.equal(p95OfMetric('duration_total_ms', { totals, events: 6 }), 400);
});

test('p95 与时间流逝那条路径用同一条规则', () => {
  // 100 个键里 96 个是 1 次、4 个是 100 次：不到 5% 的大键抬不动分母，
  // 否则一个 Space 就把其余键压成同一档色。
  const values = [...Array(96).fill(1), ...Array(4).fill(100)];
  assert.equal(p95OfCounts(values), 1);
  // 大键超过 5% 时它就该被算进来——分位数不是"忽略最大值"，是"忽略尾巴"。
  assert.equal(p95OfCounts([...Array(90).fill(1), ...Array(10).fill(100)]), 100);
  // 全是 0 时给 1，避免除零。
  assert.equal(p95OfCounts([0, 0, 0]), 1);
});
