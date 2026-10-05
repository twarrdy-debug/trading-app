import type { TradeStats } from '@trading/api/types';
import { LANGUAGES } from '@trading/shared';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useAuthConfig } from '../../api/auth.ts';
import { EquityChart } from '../../components/charts/EquityChart.tsx';
import { InstrumentBadge } from '../../components/ui/InstrumentBadge.tsx';
import { useLanguage, useSetLanguage, useT } from '../../i18n/index.tsx';
import { formatAmount } from '../../lib/format.ts';
import { APP_NAME } from '../../layout/AppShell.tsx';
import { DashboardTiles } from '../dashboard/DashboardTiles.tsx';

/** Invented figures for the preview; never a real user's results. */
const SAMPLE_CURVE = [120, -80, 260, 410, 180, 520, 760, 690, 940, 1210, 1080, 1460, 1720, 1650, 2010].map((cumulative, i, all) => ({
  date: `2026-09-${String(i + 8).padStart(2, '0')}`,
  cumulative,
  pnl: cumulative - (all[i - 1] ?? 0),
}));

const SAMPLE_STATS = {
  currency: 'USD',
  summary: { pnl: 2010, returnPct: 4.02, profitFactor: 2.31, winRate: 61.54, wins: 16, losses: 10, breakevens: 4, avgWin: 214.5, avgLoss: -142.2 },
  equityCurve: SAMPLE_CURVE,
} as unknown as TradeStats;

const Logo = () => (
  <span className="flex size-9 items-center justify-center rounded-[10px] bg-accent">
    <svg width="20" height="20" viewBox="0 0 28 28" fill="none" stroke="var(--on-accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 14h8l3-8 4 16 3-8h6" />
    </svg>
  </span>
);

/** Public page for signed-out visitors: what the app does, with live components on sample data. */
export function LandingPage() {
  const all = useT();
  const t = all.landing;
  const language = useLanguage();
  const setLanguage = useSetLanguage();
  const { data: config } = useAuthConfig();
  const registration = config?.registration ?? 'invite';

  const primary =
    registration === 'closed' ? null : (
      <Link to="/rejestracja" className="inline-flex h-12 items-center rounded-(--radius-control) bg-accent px-6 text-[15px] font-bold text-on-accent no-underline hover:brightness-105">
        {registration === 'open' ? t.ctaOpen : t.ctaInvite}
      </Link>
    );
  const signIn = (
    <Link to="/logowanie" className="inline-flex h-12 items-center rounded-(--radius-control) border border-line bg-panel px-6 text-[15px] font-semibold text-ink no-underline hover:bg-raised">
      {t.ctaSignIn}
    </Link>
  );

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 bg-bg/85 px-4 pt-4 backdrop-blur md:px-8">
        <div className="card mx-auto flex h-15 max-w-6xl items-center gap-4 rounded-(--radius-control) pr-2 pl-4">
          <span className="flex items-center gap-2.5">
            <Logo />
            <span className="text-[15px] font-bold">{APP_NAME}</span>
          </span>
          <nav aria-label={all.nav.main} className="hidden gap-1 text-sm md:flex">
            <a href="#funkcje" className="rounded-[10px] px-3.5 py-2 font-medium text-dim no-underline hover:bg-chip hover:text-ink">
              {t.nav.features}
            </a>
            <a href="#jak-zaczac" className="rounded-[10px] px-3.5 py-2 font-medium text-dim no-underline hover:bg-chip hover:text-ink">
              {t.nav.how}
            </a>
          </nav>
          <div className="grow" />
          <div role="group" aria-label={all.settings.language} className="flex gap-1 text-xs">
            {LANGUAGES.map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={l === language}
                onClick={() => setLanguage(l)}
                className={`rounded-lg px-2 py-1 font-semibold uppercase ${l === language ? 'bg-chip text-ink' : 'text-dim hover:text-ink'}`}
              >
                {l}
              </button>
            ))}
          </div>
          <Link to="/logowanie" className="rounded-[10px] px-3.5 py-2 text-sm font-semibold text-ink no-underline hover:bg-chip">
            {t.nav.signIn}
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-20 px-4 pt-12 pb-16 md:px-8 md:pt-16">
        {/* Hero: the promise on the left, the real dashboard tiles and chart on sample data below. */}
        <section className="flex flex-col gap-10">
          <div className="flex max-w-3xl flex-col gap-5">
            <span className="text-sm font-semibold text-accent-ink">{t.eyebrow}</span>
            <h1 className="m-0 text-4xl leading-[1.08] font-extrabold tracking-tight text-balance md:text-6xl">{t.title}</h1>
            <p className="m-0 max-w-2xl text-lg text-dim">{t.lead}</p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              {primary}
              {signIn}
            </div>
            {registration === 'invite' && <span className="text-[13px] text-dim">{t.inviteNote}</span>}
          </div>

          <div className="relative flex flex-col gap-4 rounded-[24px] bg-chip/60 p-3 md:p-5">
            <span className="absolute -top-3 right-5 rounded-full bg-panel px-3 py-1 text-xs font-semibold text-dim shadow-(--shadow)">{t.sample}</span>
            <DashboardTiles stats={SAMPLE_STATS} />
            <div className="card px-3 py-4">
              <EquityChart data={SAMPLE_CURVE} currency="USD" height={220} polarity />
            </div>
          </div>
          <p className="m-0 font-mono text-xs text-dim">{t.sessions}</p>
        </section>

        <section id="funkcje" className="flex scroll-mt-28 flex-col gap-8">
          <h2 className="m-0 max-w-2xl text-3xl font-extrabold tracking-tight text-balance">{t.featuresTitle}</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Feature title={t.features.journal.title} text={t.features.journal.text}>
              <div className="flex flex-col gap-2">
                <DemoRow symbol="EURUSD" result={formatAmount(420, 'USD')} r="+2,1 R" tone="buy" label={t.demo.journalRows[0]!} />
                <DemoRow symbol="XAUUSD" result={formatAmount(-200, 'USD')} r="−1 R" tone="sell" label={t.demo.journalRows[1]!} />
              </div>
            </Feature>
            <Feature title={t.features.discipline.title} text={t.features.discipline.text}>
              <div className="flex flex-col gap-2.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-dim">{all.dashboard.todayScore}</span>
                  <span className="font-mono text-xl font-bold text-ink">3/4</span>
                </div>
                <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                  {t.demo.checks.map((check, i) => (
                    <li key={check} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${i === 2 ? 'bg-sell-soft text-sell' : 'bg-buy-soft text-buy'}`}>
                      {i === 2 ? '✕' : '✓'} {check}
                    </li>
                  ))}
                </ul>
              </div>
            </Feature>
            <Feature title={t.features.prop.title} text={t.features.prop.text}>
              <div className="flex flex-col gap-2 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-dim">{t.demo.prop}</span>
                  <span className="font-mono font-semibold">{formatAmount(1650, 'USD', false)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-grid">
                  <span className="block h-full w-[35%] rounded-full bg-accent" />
                </div>
                <div className="flex justify-between">
                  <span className="text-dim">{t.demo.propTarget}</span>
                  <span className="font-mono font-semibold text-buy">62%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-grid">
                  <span className="block h-full w-[62%] rounded-full bg-buy" />
                </div>
              </div>
            </Feature>
            <Feature title={t.features.calculator.title} text={t.features.calculator.text}>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                <div className="flex flex-col gap-0.5 rounded-(--radius-control) bg-raised p-3">
                  <span className="text-[11px] text-dim">{t.demo.calculatorFrom}</span>
                  <span className="font-mono text-base font-bold whitespace-nowrap">21 450,0</span>
                </div>
                <span aria-hidden className="text-dim">→</span>
                <div className="flex flex-col gap-0.5 rounded-(--radius-control) bg-raised p-3">
                  <span className="text-[11px] text-dim">{t.demo.calculatorTo}</span>
                  <span className="font-mono text-base font-bold whitespace-nowrap">21 512,25</span>
                </div>
              </div>
            </Feature>
            <Feature title={t.features.news.title} text={t.features.news.text}>
              <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13px]">
                {t.demo.headlines.map((headline, i) => (
                  <li key={headline} className="flex items-start gap-2">
                    <span className="shrink-0 font-mono text-dim">{i === 0 ? '14:30' : '20:00'}</span>
                    {i === 0 && <span className="shrink-0 rounded-[5px] bg-breaking px-1.5 text-[11px] font-bold text-on-breaking">{t.demo.newsBreaking}</span>}
                    <span className={i === 0 ? 'font-semibold' : ''}>{headline}</span>
                  </li>
                ))}
              </ul>
            </Feature>
            <Feature title={t.features.strategies.title} text={t.features.strategies.text}>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-bold">{t.demo.strategy}</span>
                <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {t.demo.rules.map((rule, i) => (
                    <li key={rule} className="flex items-center gap-2 rounded-[10px] bg-raised px-2 py-1.5 text-[13px]">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-panel font-mono text-[11px] font-semibold">{i + 1}</span>
                      {rule}
                    </li>
                  ))}
                </ol>
              </div>
            </Feature>
          </div>
        </section>

        <section id="jak-zaczac" className="flex scroll-mt-28 flex-col gap-8">
          <h2 className="m-0 text-3xl font-extrabold tracking-tight">{t.howTitle}</h2>
          <ol className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
            {t.steps.map((step, i) => (
              <li key={step.title} className="card flex flex-col gap-2 p-6">
                <span className="font-mono text-sm font-bold text-accent-ink">{i + 1}</span>
                <h3 className="m-0 text-lg font-bold">{step.title}</h3>
                <p className="m-0 text-sm text-dim">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="card flex flex-col items-start gap-5 p-8 md:flex-row md:items-center md:p-10">
          <h2 className="m-0 grow text-2xl font-extrabold tracking-tight text-balance md:text-3xl">{t.finalTitle}</h2>
          <div className="flex shrink-0 flex-wrap gap-3">
            {primary}
            {signIn}
          </div>
        </section>
      </main>

      <footer className="mt-auto px-4 pb-8 text-center text-xs text-dim md:px-8">
        {APP_NAME} · {t.footer}
      </footer>
    </div>
  );
}

function Feature({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <article className="card flex flex-col gap-4 p-6">
      <div className="rounded-(--radius-control) border border-line bg-panel p-4">{children}</div>
      <h3 className="m-0 text-lg font-bold">{title}</h3>
      <p className="m-0 text-sm text-dim">{text}</p>
    </article>
  );
}

function DemoRow({ symbol, result, r, tone, label }: { symbol: string; result: string; r: string; tone: 'buy' | 'sell'; label: string }) {
  return (
    <div className={`flex items-center gap-3 rounded-[10px] px-2.5 py-2 ${tone === 'buy' ? 'bg-buy-soft' : 'bg-sell-soft'}`}>
      <InstrumentBadge symbol={symbol} />
      <span className="grow text-[11px] text-dim">{label}</span>
      <span className="flex flex-col items-end">
        <span className={`font-mono text-sm font-semibold whitespace-nowrap ${tone === 'buy' ? 'text-buy' : 'text-sell'}`}>{result}</span>
        <span className="font-mono text-[11px] text-dim">{r}</span>
      </span>
    </div>
  );
}
