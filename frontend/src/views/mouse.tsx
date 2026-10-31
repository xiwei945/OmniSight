// 鼠标视图：点击次数、按键分布、应用排行、时间分布、键鼠比。
//
// 这一屏只有一个指标（次数），因此**不接管指标带**（`#metricbar` 只属于键盘视图）：
// 给一个只有一项的分段器等于制造一排永远按不动的按钮。
//
// 布局照键盘视图的骨架来，读者在四个面板之间移动时不必重新学一遍：
//
//   鼠标                                        更新于 …   ← 段标题 + Updated
//   ┌ 点击概览 ┐
//   │ 四格：次数 / 活跃天数 / 平均每天 / 键鼠比              │
//   │ 五根条：左 / 右 / 中 / 侧键 1 / 侧键 2                 │
//   ┌ 主要应用 2fr ┐ ┌ 一天里的分布 1fr ┐
//   ┌ 点击趋势（通栏）┐
//
// **能力不可用时整块换成说明**，不画一张全 0 的图：那会让用户以为自己没点鼠标，而真相
// 是这台机器（或这个平台）测不到。文案全部来自后端 degraded[]，前端不编（07 文档 §10）。
import { Chart } from '../charts/Chart.tsx';
import { scaleBarsDescribe, scaleBarsDraw } from '../charts/scale-bars.ts';
import type { ScaleBarsData } from '../charts/scale-bars.ts';
import { Card, Section } from '../components/Card.tsx';
import { hideChartTooltip, showChartTooltip } from '../components/chart-hover.ts';
import { Updated } from '../components/PeriodNav.tsx';
import { Quad } from '../components/Quad.tsx';
import { capabilityOf, noticeFor } from '../components/degraded.tsx';
import {
  CapabilityNotice,
  EmptyState,
  ErrorState,
  SkeletonRows,
} from '../components/states.tsx';
import { Icon } from '../components/Icon.tsx';
import { fetchInto } from '../core/loader.ts';
import { getState } from '../core/store.ts';
import { useResource, useSlice } from '../core/useStore.ts';
import { formatCount, formatDelta, formatPercent } from '../domain/format.ts';
import { periodParams } from '../domain/period.ts';
import type { State } from '../core/store.ts';
import type { DataRequest, MouseButtonTally } from '../types/api.d.ts';

export const title = '鼠标';

export function needs(state: State): DataRequest[] {
  return [
    // 一屏一个请求：五张卡来自同一批聚合行（见 presentation/api/mouse.py）。
    { key: 'mouse', path: '/mouse', params: periodParams(state.period) },
  ];
}

function reload(): void {
  const state = getState();
  fetchInto('mouse', '/mouse', periodParams(state.period));
}

export function View() {
  const capabilities = useSlice('capabilities');
  const degraded = useSlice('degraded');
  const { data, loading, error } = useResource('mouse');
  const mouseOk = capabilityOf(capabilities, 'mouse');
  const notice = noticeFor(degraded, 'mouse');

  return (
    <>
      <h1 className="view__title sr-only" tabIndex={-1} id="view-title">
        鼠标
      </h1>

      <Section
        title="鼠标"
        sub="只统计按键次数，不记录光标位置、滚轮与移动距离"
        lead
        right={<Updated />}
      >
        <Card title="点击概览" subtitle="这段时间里点了多少次">
          {!mouseOk ? (
            <CapabilityNotice
              title={notice?.title || '当前环境无法采集鼠标'}
              detail={notice?.detail || '键盘与屏幕时间统计不受影响。'}
              hint={notice?.hint || ''}
            />
          ) : error ? (
            <ErrorState message={error.message} onRetry={reload} />
          ) : !data ? (
            loading ? <SkeletonRows count={2} /> : null
          ) : data.totals && data.totals.click_count > 0 ? (
            <>
              <Quad items={quadOf(data.totals, data.keyboard)} />
              {data.totals.delta_vs_previous ? (
                <div className="card__hint">
                  较上一周期 {formatDelta(data.totals.delta_vs_previous)}
                </div>
              ) : null}
              <ButtonSplit buttons={data.buttons || []} />
            </>
          ) : (
            <EmptyState
              title="这段时间没有记录到鼠标点击"
              detail="换一个日期，或确认托盘里的采集没有被暂停"
              mark={<Icon name="mouse" size={28} />}
            />
          )}
        </Card>
      </Section>

      {/* 鼠标测不到时**整屏只留一句说明**：五张卡讲的是同一件事，分开显示只会让
          用户对着四块空面板猜哪一块出了问题。 */}
      {mouseOk ? (
        <>
          <div className="grid grid--2">
            <Card title="主要应用" subtitle="按点击次数排序">
              <TopApps />
            </Card>
            <Card title="一天里的分布" subtitle="按小时，本周期内合计">
              <Hours />
            </Card>
          </div>

          <Section title="点击趋势" sub="少于 120 天按日，再长按月">
            <div className="card">
              <Trend />
            </div>
          </Section>
        </>
      ) : null}
    </>
  );
}

/** 四格读数。键鼠比是**唯一一个跨面板**的指标：它要键盘与鼠标两份数据才说得出。 */
function quadOf(
  totals: { click_count: number; active_days: number; per_day: number },
  keyboard: { presses_per_click: number | null } | undefined,
): { label: string; value: string }[] {
  const ratio = keyboard?.presses_per_click;
  return [
    { label: '点击次数', value: formatCount(totals.click_count) },
    { label: '活跃天数', value: `${totals.active_days} 天` },
    { label: '日均点击', value: formatCount(Math.round(totals.per_day)) },
    {
      label: '键鼠比',
      // 没有点击时不给 0：那会被读成"点了很多但一次键都没按"。
      value: ratio === null || ratio === undefined ? '—' : `1 : ${ratio}`,
    },
  ];
}

function ButtonSplit({ buttons }: { buttons: readonly MouseButtonTally[] }) {
  const top = Math.max(1, ...buttons.map((item) => Number(item.click_count) || 0));
  return (
    <div className="mouse-buttons">
      {buttons.map((button) => (
        <div className="mouse-button" key={button.id}>
          <span className="mouse-button__label">{button.label}</span>
          <div
            className="bar"
            style={{ '--fill': (Number(button.click_count) || 0) / top } as React.CSSProperties}
          >
            <i />
          </div>
          <span className="mouse-button__count">{formatCount(button.click_count)}</span>
          <span className="mouse-button__percent">{formatPercent(button.percent)}</span>
        </div>
      ))}
    </div>
  );
}

function TopApps() {
  const { data, loading, error } = useResource('mouse');
  if (error) return <ErrorState message={error.message} onRetry={reload} />;
  if (!data) return loading ? <SkeletonRows count={5} /> : null;
  const apps = data.apps || [];
  if (!apps.length) {
    return <EmptyState title="这段时间没有按应用归属的点击" detail="前台识别不可用时点击仍会计入总数" />;
  }
  const top = Math.max(1, ...apps.map((app) => Number(app.click_count) || 0));
  return (
    <div className="mouse-apps">
      {apps.map((app, index) => (
        <div className="mouse-app" key={app.app_id}>
          <span className="rank">{index + 1}</span>
          <span className="mouse-app__name truncate" title={app.display_name}>
            {app.display_name}
          </span>
          <div
            className="bar"
            style={{ '--fill': (Number(app.click_count) || 0) / top } as React.CSSProperties}
          >
            <i />
          </div>
          <span className="mouse-app__count">{formatCount(app.click_count)}</span>
          <span className="mouse-app__percent">{formatPercent(app.percent)}</span>
        </div>
      ))}
    </div>
  );
}

function Hours() {
  const { data, loading } = useResource('mouse');
  if (!data) return loading ? <SkeletonRows count={1} /> : null;
  const hours = data.hours || [];
  if (!hours.some((hour) => (hour.click_count || 0) > 0)) {
    return <EmptyState title="这段时间没有按小时的点击" />;
  }
  const payload: ScaleBarsData = {
    buckets: hours.map((hour) => ({
      bucket: String(hour.hour),
      label: `${hour.hour}:00`,
      value: Number(hour.click_count) || 0,
    })),
    valueLabel: '点击次数',
    caption: '按小时的点击次数',
    summary: '按小时的点击次数，共 24 个桶',
  };
  return (
    <div className="chart chart--scale">
      <Chart<ScaleBarsData>
        data={payload}
        draw={scaleBarsDraw({ format: formatCount, accent: 'keys' })}
        describe={scaleBarsDescribe({ format: formatCount })}
        height={190}
        label={payload.summary}
        onHover={showChartTooltip}
        onLeave={hideChartTooltip}
      />
    </div>
  );
}

function Trend() {
  const { data, loading } = useResource('mouse');
  if (!data) return loading ? <SkeletonRows count={1} /> : null;
  const timeline = data.days;
  const buckets = timeline?.buckets || [];
  if (!buckets.some((bucket) => (bucket.click_count || 0) > 0)) {
    return <EmptyState title="这段时间没有点击记录" />;
  }
  const byMonth = timeline?.grain === 'month';
  const payload: ScaleBarsData = {
    buckets: buckets.map((bucket) => ({
      bucket: bucket.bucket,
      label: bucket.label,
      value: Number(bucket.click_count) || 0,
    })),
    valueLabel: '点击次数',
    caption: `按${byMonth ? '月' : '日'}的点击次数`,
    summary: `按${byMonth ? '月' : '日'}的点击次数，共 ${buckets.length} 个桶`,
  };
  return (
    <div className="chart chart--scale">
      <Chart<ScaleBarsData>
        data={payload}
        draw={scaleBarsDraw({ format: formatCount, accent: 'keys' })}
        describe={scaleBarsDescribe({ format: formatCount })}
        height={190}
        label={payload.summary}
        onHover={showChartTooltip}
        onLeave={hideChartTooltip}
      />
    </div>
  );
}
