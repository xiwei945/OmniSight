// 计数类数据的共用小工具。
//
// 两条动画（时间流逝的逐次流、今天的按键回放）都要回答同一个问题：色阶的归一化上限
// 取多少。两处各算一份迟早会不一致，而症状很隐蔽——**同一个键在两个页面里颜色不同**，
// 却没有任何地方报错。所以分位数只留这一份。
//
// 纯函数，`node --test --experimental-strip-types` 直接跑。

/**
 * 95 分位，只统计大于 0 的值。空集返回 1，避免调用方除零。
 *
 * 为什么是 p95 而不是 max：一个 Space 就能把其余键压成同一档色（06 文档 §7）。
 */
export function p95OfCounts(values: Iterable<number>): number {
  const positive: number[] = [];
  for (const value of values) {
    if (value > 0) positive.push(value);
  }
  if (!positive.length) return 1;
  positive.sort((left, right) => left - right);
  const position = Math.min(positive.length - 1, Math.floor(positive.length * 0.95));
  return Math.max(1, positive[position]);
}
