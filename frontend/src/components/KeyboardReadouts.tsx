// 键盘板的两个"读数"块：**布局外键位**与**表格孪生**。2D 与 3D 都要它们，所以从
// `KeyboardView` 里抽出来，由视图在两种渲染路径下各渲染一次（14 文档 §4.4）。
import { formatPercent } from '../domain/format.ts';
import { formatMetric, metricOf } from '../domain/metrics.ts';
import type { HeatmapKey } from '../types/api.d.ts';

/** 布局里没有的键（后端的 orphan_keys）。不渲染它们，键盘总数就与指标卡不一致。 */
export function Orphans({ keys, metric }: { keys: readonly HeatmapKey[] | undefined; metric: string }) {
  if (!keys?.length) return null;
  return (
    <div className="orphans">
      <div className="orphans__title">不在当前布局中的键（{keys.length}）</div>
      <div className="orphans__list">
        {keys.map((key) => {
          const record = key as unknown as Record<string, unknown>;
          return (
            <span className="key-chip" key={key.id}>
              <b>{key.label || key.id}</b>
              <span>{formatMetric(metric, Number(record[metric] ?? key.press_count ?? 0))}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 表格孪生：每个键的完整读数，可复制（14 文档 §4.4）。
 *
 * 键盘/3D 画布都没有一条能让屏幕阅读器逐键读出读数的路径，这张折叠表补上它，同时
 * 兜住"键面数值印不下"与"3D 键帽上没有数字"两种场景。
 */
export function KeyTable({ values, metric }: { values: Map<string, HeatmapKey>; metric: string }) {
  const definition = metricOf(metric);
  const read = (entry: HeatmapKey) =>
    Number((entry as unknown as Record<string, unknown>)[metric]) || 0;
  const list = [...values.values()]
    .filter((entry) => read(entry) > 0)
    .sort((a, b) => read(b) - read(a));
  if (!list.length) return null;
  return (
    <details className="keyboard-table">
      <summary>表格视图</summary>
      <div className="keyboard-table__scroll">
        <table className="table">
          <thead>
            <tr>
              <th>键位</th>
              <th>次数</th>
              <th>占比</th>
              <th>均时长</th>
            </tr>
          </thead>
          <tbody>
            {list.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.label || entry.id}</td>
                <td className="numeric">{definition.format(read(entry))}</td>
                <td className="numeric">{formatPercent(entry.percent)}</td>
                <td className="numeric">{formatMetric('duration_avg_ms', entry.duration_avg_ms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
