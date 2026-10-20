import { Link } from '@tanstack/react-router';
import { useT } from '../../i18n/index.tsx';

/** Analysis and Backtesting as two pill tabs under one menu item. */
export function AnalysisTabs() {
  const t = useT().backtest.tabs;
  const tab = 'flex h-8 items-center rounded-[9px] px-3.5 text-[13px] transition';
  return (
    <nav aria-label={t.analysis} className="inline-flex gap-0.5 self-start rounded-(--radius-control) bg-chip p-[3px]">
      {[
        { to: '/analiza', label: t.analysis },
        { to: '/analiza/backtesting', label: t.backtest },
      ].map((item) => (
        <Link
          key={item.to}
          to={item.to}
          activeOptions={{ exact: true }}
          className={`${tab} font-medium text-dim hover:text-ink`}
          activeProps={{ className: `${tab} bg-panel font-bold text-ink shadow-sm`, 'aria-current': 'page' }}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
