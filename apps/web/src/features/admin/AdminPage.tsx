import { Link, useParams } from '@tanstack/react-router';
import { useMe } from '../../api/hooks.ts';
import { useT } from '../../i18n/index.tsx';
import { InvitesManager } from '../auth/InvitesManager.tsx';
import { AdminInstruments } from './AdminInstruments.tsx';
import { AdminStats } from './AdminStats.tsx';
import { AdminSystem } from './AdminSystem.tsx';
import { AdminUsers } from './AdminUsers.tsx';

/** URL slug → section; the slugs are Polish like the other paths. */
const SECTIONS = [
  { slug: 'uzytkownicy', key: 'users' },
  { slug: 'statystyki', key: 'stats' },
  { slug: 'system', key: 'system' },
  { slug: 'instrumenty', key: 'instruments' },
  { slug: 'zaproszenia', key: 'invites' },
] as const;

/** Administration for the admin role: users, statistics, system status, instruments, invitations. */
export function AdminPage() {
  const all = useT();
  const t = all.admin;
  const { data: me } = useMe();
  const { section: slug } = useParams({ strict: false }) as { section?: string };

  if (!me) return <main className="grow p-8 text-dim">{all.common.loading}</main>;
  if (me.role !== 'admin') return <main className="grow p-8 text-dim">{all.common.errorStatus(403)}</main>;
  const current = SECTIONS.find((s) => s.slug === slug) ?? SECTIONS[0];

  return (
    <main className="mx-auto flex w-full max-w-7xl grow flex-col gap-5 p-4 md:px-8 md:py-6">
      <h1 className="m-0 text-2xl font-bold tracking-tight">{t.title}</h1>
      <div className="grid items-start gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label={t.sectionsLabel} className="lg:card -mx-4 flex gap-1 overflow-x-auto px-4 lg:sticky lg:top-28 lg:mx-0 lg:flex-col lg:p-2">
          {SECTIONS.map((s) => (
            <Link
              key={s.slug}
              to="/admin/$section"
              params={{ section: s.slug }}
              aria-current={s === current ? 'page' : undefined}
              className={`shrink-0 rounded-[10px] px-3.5 py-2.5 text-sm no-underline transition ${
                s === current ? 'bg-panel font-bold text-ink shadow-sm lg:bg-chip lg:shadow-none' : 'font-medium text-dim hover:bg-chip hover:text-ink'
              }`}
            >
              {t.sections[s.key]}
            </Link>
          ))}
        </nav>
        <div className="flex min-w-0 flex-col gap-4">
          <header className="flex flex-col gap-1">
            <h2 className="m-0 text-lg font-bold">{t.sections[current.key]}</h2>
            <p className="m-0 max-w-3xl text-[13px] text-dim">{t.intros[current.key]}</p>
          </header>
          {current.key === 'users' && <AdminUsers me={me} />}
          {current.key === 'stats' && <AdminStats />}
          {current.key === 'system' && <AdminSystem timezone={me.settings.timezone} />}
          {current.key === 'instruments' && <AdminInstruments />}
          {current.key === 'invites' && (
            <section className="card p-5">
              <InvitesManager timezone={me.settings.timezone} />
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
