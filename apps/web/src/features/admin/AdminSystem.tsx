import type { SystemStatus } from '@trading/api/types';
import type { ReactNode } from 'react';
import { useRefreshBasis, useRefreshCalendar, useRefreshNews, useSystemStatus } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { useT } from '../../i18n/index.tsx';
import { formatDateTime, formatRelative } from '../../lib/format.ts';

type Level = 'ok' | 'warn' | 'off' | 'error';

const LEVEL_TONE: Record<Level, string> = {
  ok: 'bg-buy-soft text-buy',
  warn: 'bg-warn-bg text-warn',
  off: 'bg-chip text-dim',
  error: 'bg-sell-soft text-sell',
};
const LEVEL_DOT: Record<Level, string> = { ok: 'bg-buy', warn: 'bg-warn', off: 'bg-dim', error: 'bg-sell' };

const ageMs = (iso: string | null | undefined) => (iso ? Date.now() - new Date(iso).getTime() : Infinity);
const HOUR = 3_600_000;

/** One background job's levels: on time, late, off or failing. */
function newsLevel(n: SystemStatus['news']): Level {
  if (!n.enabled) return 'off';
  if (n.lastError && ageMs(n.lastSuccessAt) > 10 * 60_000) return 'error';
  return ageMs(n.lastSuccessAt) <= Math.max(5 * 60_000, n.intervalSeconds * 3_000) ? 'ok' : 'warn';
}
const scheduledLevel = (hours: number, last: string | null | undefined): Level =>
  hours === 0 ? 'off' : ageMs(last) <= hours * 2 * HOUR ? 'ok' : ageMs(last) <= hours * 6 * HOUR ? 'warn' : 'error';

function StatusCard({ title, level, action, children }: { title: string; level: Level; action?: ReactNode; children: ReactNode }) {
  const t = useT().admin.system;
  return (
    <section className="card flex flex-col gap-3 p-5">
      <header className="flex items-center gap-2.5">
        <span className={`size-2.5 rounded-full ${LEVEL_DOT[level]}`} aria-hidden />
        <h3 className="m-0 grow text-[15px] font-bold">{title}</h3>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${LEVEL_TONE[level]}`}>{t.levels[level]}</span>
      </header>
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">{children}</dl>
      {action && <div className="flex justify-end">{action}</div>}
    </section>
  );
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <>
    <dt className="text-dim">{label}</dt>
    <dd className="m-0 min-w-0 break-words">{children}</dd>
  </>
);

/** Background jobs and configuration at a glance; refreshes every 30 s. */
export function AdminSystem({ timezone }: { timezone: string }) {
  const all = useT();
  const t = all.admin.system;
  const { data: s, refetch } = useSystemStatus();
  const news = useRefreshNews();
  const calendar = useRefreshCalendar();
  const basis = useRefreshBasis();
  if (!s) return <p className="m-0 text-sm text-dim">{all.common.loading}</p>;

  const when = (iso: string | null | undefined) =>
    iso ? (
      <span title={formatDateTime(iso, timezone)}>{formatRelative(iso)}</span>
    ) : (
      <span className="text-dim">{t.never}</span>
    );
  const every = (hours: number) => (hours === 0 ? t.off : t.every(`${hours} h`));
  const basisLast = s.basis.pairs.map((p) => p.measuredAt).sort().at(-1) ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <StatusCard title={t.app} level={s.app.version ? 'ok' : 'warn'}>
        <Row label={t.version}>{s.app.version ? <span className="font-mono">{s.app.version}</span> : <span className="text-dim">{t.versionUnknown}</span>}</Row>
        <Row label={t.environment}>{s.app.environment}</Row>
        <Row label={t.registration}>{t.registrationModes[s.app.registration] ?? s.app.registration}</Row>
        <Row label={t.runningSince}>{when(s.app.startedAt)}</Row>
        <Row label="Node">{s.app.node}</Row>
      </StatusCard>

      <StatusCard title={t.database} level="ok">
        <Row label={t.migrations}>{s.database.migrations}</Row>
        <Row label={t.size}>{s.database.size ?? '—'}</Row>
      </StatusCard>

      <StatusCard title={t.mail} level={s.mail.configured ? 'ok' : 'warn'}>
        {s.mail.configured ? <Row label={t.mailFrom}>{s.mail.from}</Row> : <Row label="SMTP">{t.mailOff}</Row>}
      </StatusCard>

      <StatusCard
        title={t.news}
        level={newsLevel(s.news)}
        action={
          <Button size="sm" disabled={news.isPending || !s.news.enabled} onClick={() => news.mutate()}>
            {t.fetchNow}
          </Button>
        }
      >
        <Row label={t.mode}>
          {s.news.enabled ? `${t.newsModes[s.news.mode ?? ''] ?? '—'} · ${t.every(`${s.news.intervalSeconds} s`)}` : t.off}
        </Row>
        <Row label={t.lastSuccess}>{when(s.news.lastSuccessAt)}</Row>
        {s.news.lastError && <Row label={t.lastError}><span className="text-sell">{s.news.lastError}</span></Row>}
        <Row label={t.latestHeadline}>{when(s.news.latestHeadlineAt)}</Row>
        <Row label={t.last24h}>{s.news.last24h}</Row>
        <Row label={t.streams}>{s.news.openStreams}</Row>
      </StatusCard>

      <StatusCard
        title={t.calendar}
        level={scheduledLevel(s.calendar.intervalHours, s.calendar.lastFetchedAt)}
        action={
          <Button size="sm" disabled={calendar.isPending} onClick={() => calendar.mutate(undefined, { onSettled: () => void refetch() })}>
            {t.refreshNow}
          </Button>
        }
      >
        <Row label={t.lastFetch}>
          {when(s.calendar.lastFetchedAt)} · {every(s.calendar.intervalHours)}
        </Row>
        <Row label={t.eventsAround}>{s.calendar.eventsAroundToday}</Row>
      </StatusCard>

      <StatusCard
        title={t.basis}
        level={scheduledLevel(s.basis.intervalHours, basisLast)}
        action={
          <Button size="sm" disabled={basis.isPending} onClick={() => basis.mutate(undefined, { onSettled: () => void refetch() })}>
            {t.measureNow}
          </Button>
        }
      >
        {s.basis.pairs.map((p) => (
          <Row key={p.pairKey} label={p.pairKey}>
            {when(p.measuredAt)} · <span className={p.live ? 'text-buy' : 'text-dim'}>{p.live ? t.live : t.notLive}</span>
          </Row>
        ))}
        <Row label="">{every(s.basis.intervalHours)}</Row>
      </StatusCard>
    </div>
  );
}
