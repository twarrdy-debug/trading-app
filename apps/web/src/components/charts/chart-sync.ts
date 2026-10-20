import type { IChartApi, IRange, ISeriesApi, Time, UTCTimestamp } from 'lightweight-charts';

interface Member {
  chart: IChartApi;
  series: ISeriesApi<'Candlestick'>;
  /** Close per candle time, for placing the crosshair on this chart's own price. */
  closes: () => Map<number, number>;
}

/**
 * Links charts of the same moments on different markets (calculator PRO): scrolling, zooming and
 * the crosshair follow the chart the pointer is on. Only that chart drives the others, so the
 * charts never echo each other's updates back.
 */
export class ChartSync {
  private members = new Set<Member>();
  private active: Member | null = null;

  join(member: Member, element: HTMLElement) {
    this.members.add(member);
    const activate = () => {
      this.active = member;
    };
    element.addEventListener('pointerenter', activate);
    element.addEventListener('pointerdown', activate);
    element.addEventListener('wheel', activate, { passive: true });
    const onRange = (range: IRange<Time> | null) => {
      if (this.active !== member || !range) return;
      for (const other of this.others(member)) {
        try {
          other.chart.timeScale().setVisibleRange(range);
        } catch {
          // The other chart has no data yet.
        }
      }
    };
    const onCross = (param: { time?: Time }) => {
      if (this.active !== member) return;
      for (const other of this.others(member)) {
        const close = param.time != null ? other.closes().get(param.time as number) : undefined;
        if (close == null) other.chart.clearCrosshairPosition();
        else other.chart.setCrosshairPosition(close, param.time as UTCTimestamp, other.series);
      }
    };
    member.chart.timeScale().subscribeVisibleTimeRangeChange(onRange);
    member.chart.subscribeCrosshairMove(onCross);
    return () => {
      element.removeEventListener('pointerenter', activate);
      element.removeEventListener('pointerdown', activate);
      element.removeEventListener('wheel', activate);
      this.members.delete(member);
      if (this.active === member) this.active = null;
    };
  }

  private others(member: Member) {
    return [...this.members].filter((m) => m !== member);
  }
}
