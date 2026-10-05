import { useAdminStats } from '../../api/hooks.ts';
import { BarList } from '../../components/charts/BarList.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { Stat } from '../../components/ui/Stat.tsx';
import { useT } from '../../i18n/index.tsx';
import { formatDate } from '../../lib/format.ts';

/** How the app is used: accounts, activity, trades, sign-ups per week and group codes. */
export function AdminStats() {
  const all = useT();
  const t = all.admin.stats;
  const { data: s } = useAdminStats();
  if (!s) return <p className="m-0 text-sm text-dim">{all.common.loading}</p>;
  const roleName = (role: string) => all.settings.roles[role] ?? role;
  const attention = [s.users.disabled > 0 && t.disabled(s.users.disabled), s.users.onboardingPending > 0 && t.onboarding(s.users.onboardingPending)].filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={t.users} value={String(s.users.total)} foot={t.usersFoot(s.users.new7, s.users.new30)} />
        <Stat label={t.active} value={String(s.users.active7)} foot={t.activeFoot(s.users.active30)} />
        <Stat label={t.trades} value={String(s.trades.total)} foot={t.tradesFoot(s.trades.last7, s.trades.imported)} />
        <Stat label={t.setup} value={String(s.accounts + s.strategies)} foot={t.setupFoot(s.accounts, s.strategies)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={t.signups}>
          {s.signupsPerWeek.length === 0 ? (
            <p className="m-0 px-5 pb-5 text-sm text-dim">{t.noSignups}</p>
          ) : (
            <BarList
              rows={s.signupsPerWeek.map((w) => ({ key: w.week, label: t.week(formatDate(w.week)), value: w.n, display: String(w.n) }))}
            />
          )}
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel title={t.byRole}>
            <BarList rows={s.users.byRole.map((r) => ({ key: r.role, label: roleName(r.role), value: r.n, display: String(r.n) }))} />
          </Panel>
          {attention.length > 0 && (
            <Panel title={t.attention}>
              <ul className="m-0 flex list-disc flex-col gap-1 px-10 pb-5 text-sm">
                {attention.map((line) => (
                  <li key={String(line)}>{line}</li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>

      <Panel title={t.groupCodes}>
        {s.groupCodes.length === 0 ? (
          <p className="m-0 px-5 pb-5 text-sm text-dim">{t.noCodes}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 px-5 pb-5">
            {s.groupCodes.map((c) => (
              <li key={c.code} className="flex items-center justify-between gap-3 rounded-(--radius-control) bg-raised px-4 py-3">
                <span className="flex flex-col">
                  <span className="font-mono font-semibold">{c.code}</span>
                  <span className="text-xs text-dim">{roleName(c.role)}</span>
                </span>
                <span className="font-mono text-sm font-semibold">{t.codeSignups(c.signups)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
