import { LANGUAGES } from '@trading/shared';
import { Link } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuthConfig } from '../../api/auth.ts';
import { EquityChart } from '../../components/charts/EquityChart.tsx';
import { InstrumentBadge, InstrumentLogo } from '../../components/ui/InstrumentBadge.tsx';
import { useLanguage, useSetLanguage, useT } from '../../i18n/index.tsx';
import { formatAmount, formatNumber } from '../../lib/format.ts';
import { APP_NAME } from '../../layout/AppShell.tsx';
import { NavIcon, type NavIconName } from '../../layout/NavIcon.tsx';
import { SAMPLE_CURVE } from '../dashboard/DashboardPreview.tsx';

const Logo = ({ size = 36 }: { size?: number }) => (
  <span className="flex shrink-0 items-center justify-center rounded-[10px] bg-accent" style={{ width: size, height: size }}>
    <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 28 28" fill="none" stroke="var(--on-accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 14h8l3-8 4 16 3-8h6" />
    </svg>
  </span>
);

/** Instruments in the moving strip under the hero (logos are drawn for the app, see InstrumentBadge). */
const STRIP = ['EURUSD', 'XAUUSD', 'US100', 'NQ1', 'GBPUSD', 'GC1', 'USDJPY', 'US500', 'ES1', 'AUDUSD', 'US30', 'YM1', 'USDCAD', 'MNQ1'];

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Counts from zero to `target` once after mounting (the final value straight away for reduced motion). */
function useCountUp(target: number, duration = 1400) {
  const [value, setValue] = useState(() => (reducedMotion() ? target : 0));
  useEffect(() => {
    if (reducedMotion()) return setValue(target);
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / duration);
      setValue(target * (1 - (1 - k) ** 3));
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

/** Public page for signed-out visitors: what the app does, shown with its own look on sample data. */
export function LandingPage() {
  const all = useT();
  const t = all.landing;
  const language = useLanguage();
  const setLanguage = useSetLanguage();
  const { data: config } = useAuthConfig();
  const registration = config?.registration ?? 'invite';

  const primary =
    registration === 'closed' ? null : (
      <Link to="/rejestracja" className="inline-flex h-12 items-center gap-2 rounded-(--radius-control) bg-accent px-6 text-[15px] font-bold text-on-accent no-underline transition hover:brightness-105">
        {registration === 'open' ? t.ctaOpen : t.ctaInvite}
        <span aria-hidden>→</span>
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
          {/* On phones the hero has its own sign-in button right below. */}
          <Link to="/logowanie" className="hidden rounded-[10px] px-3.5 py-2 text-sm font-semibold whitespace-nowrap text-ink no-underline hover:bg-chip sm:block">
            {t.nav.signIn}
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-20 px-4 pt-12 pb-16 md:gap-28 md:px-8 md:pt-16">
        {/* Hero: the promise on the left, the app itself (sample data) on the right, coming alive once. */}
        <section className="grid items-center gap-10 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] xl:gap-12">
          <div className="flex flex-col gap-6">
            <span className="landing-rise flex items-center gap-2 text-sm font-semibold text-accent-ink">
              <span aria-hidden className="size-2 rounded-full bg-accent" />
              {t.eyebrow}
            </span>
            <h1 className="landing-rise m-0 text-4xl leading-[1.04] font-extrabold tracking-tight text-balance md:text-6xl" style={{ animationDelay: '80ms' }}>
              {t.title}
            </h1>
            <p className="landing-rise m-0 max-w-xl text-lg text-dim" style={{ animationDelay: '160ms' }}>
              {t.lead}
            </p>
            <div className="landing-rise flex flex-wrap items-center gap-3" style={{ animationDelay: '240ms' }}>
              {primary}
              {signIn}
            </div>
            {registration === 'invite' && <span className="-mt-2 text-[13px] text-dim">{t.inviteNote}</span>}
            <dl className="m-0 grid grid-cols-1 gap-4 pt-2 sm:grid-cols-3">
              {t.facts.map((fact) => (
                <div key={fact.value} className="flex flex-col gap-0.5">
                  <dt className="text-[15px] font-bold whitespace-nowrap">{fact.value}</dt>
                  <dd className="m-0 text-[13px] text-dim">{fact.label}</dd>
                </div>
              ))}
            </dl>
          </div>
          <HeroApp />
        </section>

        <InstrumentStrip />

        <div id="funkcje" className="flex scroll-mt-28 flex-col gap-20 md:gap-28">
          <Spotlight kicker={t.journal.kicker} title={t.journal.title} text={t.journal.text} points={t.journal.points}>
            <JournalVisual />
          </Spotlight>
          <Spotlight kicker={t.monitor.kicker} title={t.monitor.title} text={t.monitor.text} points={t.monitor.points} flip>
            <MonitorVisual />
          </Spotlight>
          <Spotlight kicker={t.calculator.kicker} title={t.calculator.title} text={t.calculator.text} points={t.calculator.points}>
            <CalculatorVisual />
          </Spotlight>

          <section className="flex flex-col gap-8">
            <h2 className="m-0 max-w-2xl text-3xl font-extrabold tracking-tight text-balance">{t.moreTitle}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {(
                [
                  ['calendar', t.more.calendar],
                  ['news', t.more.news],
                  ['dashboard', t.more.prop],
                  ['analysis', t.more.strategies],
                ] as [NavIconName, { title: string; text: string }][]
              ).map(([icon, item]) => (
                <article key={item.title} className="landing-reveal card flex flex-col gap-3 p-6">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-accent/15 text-accent-ink">
                    <NavIcon name={icon} size={20} />
                  </span>
                  <h3 className="m-0 text-base font-bold">{item.title}</h3>
                  <p className="m-0 text-sm text-dim">{item.text}</p>
                </article>
              ))}
            </div>
          </section>
        </div>

        <section id="jak-zaczac" className="flex scroll-mt-28 flex-col gap-8">
          <h2 className="m-0 text-3xl font-extrabold tracking-tight">{t.howTitle}</h2>
          <ol className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
            {t.steps.map((step, i) => (
              <li key={step.title} className="landing-reveal card flex flex-col gap-2 p-6">
                <span className="flex size-8 items-center justify-center rounded-full bg-accent font-mono text-sm font-bold text-on-accent">{i + 1}</span>
                <h3 className="m-0 pt-1 text-lg font-bold">{step.title}</h3>
                <p className="m-0 text-sm text-dim">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-reveal card flex flex-col items-start gap-5 p-8 md:flex-row md:items-center md:p-10">
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

/** The app window: side menu, three tiles, the cumulative result, the monitor's tape and a live headline. */
function HeroApp() {
  const all = useT();
  const t = all.landing.preview;
  const pnl = useCountUp(2010);
  const winRate = useCountUp(61.5);
  const factor = useCountUp(2.31);
  const menu: [NavIconName, string][] = [
    ['dashboard', all.nav.dashboard],
    ['trades', all.nav.trades],
    ['journal', all.nav.journal],
    ['calculator', all.nav.calculator],
    ['calendar', all.nav.calendar],
    ['news', all.nav.news],
  ];
  const tile = (label: string, value: ReactNode) => (
    <div className="flex min-w-0 flex-col gap-1 rounded-2xl bg-raised px-3.5 py-3">
      <span className="truncate text-xs text-dim">{label}</span>
      <span className="text-xl font-bold tracking-tight whitespace-nowrap tabular-nums sm:text-[22px]">{value}</span>
    </div>
  );

  return (
    <figure className="landing-rise relative m-0" style={{ animationDelay: '200ms' }} aria-label={all.landing.sample}>
      <span className="absolute -top-3 right-5 z-10 rounded-full bg-panel px-3 py-1 text-xs font-semibold text-dim shadow-(--shadow)">{all.landing.sample}</span>
      <div className="card grid overflow-hidden shadow-(--shadow-pop) sm:grid-cols-[9.5rem_minmax(0,1fr)]">
        <aside aria-hidden className="hidden flex-col gap-1 bg-raised p-3 sm:flex">
          <span className="flex items-center gap-2 px-1.5 pb-3">
            <Logo size={26} />
            <span className="truncate text-[13px] font-bold">{APP_NAME}</span>
          </span>
          {menu.map(([icon, label], i) => (
            <span key={icon} className={`flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-[12.5px] font-semibold ${i === 0 ? 'bg-panel text-ink shadow-(--shadow)' : 'text-dim'}`}>
              <NavIcon name={icon} size={15} className={i === 0 ? 'text-accent-ink' : ''} />
              <span className="truncate">{label}</span>
            </span>
          ))}
        </aside>
        <div className="flex min-w-0 flex-col gap-3 p-3 sm:p-4">
          <div className="grid grid-cols-3 gap-2.5">
            {tile(t.netPnl, <span className="text-buy">{formatAmount(Math.round(pnl), 'USD')}</span>)}
            {tile(t.winRate, `${formatNumber(Math.round(winRate * 10) / 10)}%`)}
            {tile(t.profitFactor, formatNumber(Math.round(factor * 100) / 100))}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1 rounded-2xl bg-raised px-2 pt-3 pb-1">
              <span className="px-2 text-xs text-dim">{t.equity}</span>
              <EquityChart data={SAMPLE_CURVE} currency="USD" height={150} polarity />
            </div>
            <div className="flex min-w-0 flex-col gap-2.5 rounded-2xl bg-raised p-3.5">
              <span className="text-xs text-dim">{t.monitor}</span>
              <span className="flex flex-col">
                <span className="text-[15px] font-bold">{t.verdict}</span>
                <span className="text-xs text-dim">{t.left}</span>
              </span>
              {/* The free slot stays narrow so the filled ones have room for their figures. */}
              <ol className="m-0 mt-auto grid list-none grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem] gap-1.5 p-0">
                <li className="landing-pop flex min-h-12 min-w-0 flex-col justify-center rounded-xl bg-buy-soft px-2 py-1" style={{ animationDelay: '900ms' }}>
                  <span className="text-[10.5px] font-bold text-dim">09:12</span>
                  <span className="font-mono text-xs font-bold whitespace-nowrap text-buy">+1,2 R</span>
                </li>
                <li className="landing-pop flex min-h-12 min-w-0 flex-col justify-center rounded-xl bg-accent/15 px-2 py-1" style={{ animationDelay: '1300ms' }}>
                  <span className="text-[10.5px] font-bold text-dim">10:05</span>
                  <span className="truncate font-mono text-xs font-bold text-accent-ink">{t.open}</span>
                </li>
                <li className="flex min-h-12 items-center justify-center rounded-xl border-[1.5px] border-dashed border-line text-xs font-bold text-dim">3</li>
              </ol>
            </div>
          </div>
          <div className="landing-rise flex min-w-0 items-center gap-3 rounded-2xl bg-raised px-3.5 py-2.5" style={{ animationDelay: '1700ms' }}>
            <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-buy">
              <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-buy" />
              {t.live}
            </span>
            <span className="flex min-w-0 items-center gap-2 rounded-lg bg-breaking px-2.5 py-1 text-[12.5px] text-on-breaking">
              <span className="shrink-0 font-mono text-[11px] opacity-80">14:30</span>
              <span className="font-semibold">{t.headline}</span>
            </span>
          </div>
        </div>
      </div>
    </figure>
  );
}

/** A slow strip of the instruments the app knows; it pauses under the pointer. */
function InstrumentStrip() {
  const t = useT().landing;
  const item = (symbol: string, key: string) => (
    <span key={key} className="flex shrink-0 items-center gap-2 text-sm font-semibold text-dim">
      <InstrumentLogo symbol={symbol} size={22} />
      {symbol}
    </span>
  );
  return (
    <section aria-label={t.instruments} className="-mx-4 overflow-hidden border-y border-line bg-panel py-4 md:-mx-8 [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
      <div className="landing-marquee flex w-max gap-10">
        {STRIP.map((s) => item(s, s))}
        {/* The second copy makes the loop seamless; screen readers get the list once. */}
        <span aria-hidden className="flex gap-10">
          {STRIP.map((s) => item(s, `copy-${s}`))}
        </span>
      </div>
    </section>
  );
}

/** One feature in depth: text and points on one side, a picture of it in the app on the other. */
function Spotlight({ kicker, title, text, points, flip = false, children }: { kicker: string; title: string; text: string; points: string[]; flip?: boolean; children: ReactNode }) {
  return (
    <section className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
      <div className={`flex flex-col gap-5 ${flip ? 'lg:order-2' : ''}`}>
        <span className="text-sm font-semibold text-accent-ink">{kicker}</span>
        <h2 className="m-0 text-3xl leading-tight font-extrabold tracking-tight text-balance md:text-4xl">{title}</h2>
        <p className="m-0 text-base text-dim md:text-[17px]">{text}</p>
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {points.map((point) => (
            <li key={point} className="flex items-start gap-3 text-[15px]">
              <span aria-hidden className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-buy-soft text-[11px] font-bold text-buy">
                ✓
              </span>
              {point}
            </li>
          ))}
        </ul>
      </div>
      <div className={`landing-reveal ${flip ? 'lg:order-1' : ''}`}>{children}</div>
    </section>
  );
}

const Window = ({ children }: { children: ReactNode }) => <div className="card flex flex-col gap-4 p-4 shadow-(--shadow-pop) sm:p-5">{children}</div>;

function JournalVisual() {
  const t = useT().landing.journal;
  const rows = [
    { symbol: 'EURUSD', side: 'LONG', pnl: 420, r: '+2,1 R', badge: 'TP' },
    { symbol: 'XAUUSD', side: 'SHORT', pnl: -200, r: '−1 R', badge: 'SL' },
    { symbol: 'NQ1', side: 'LONG', pnl: 600, r: '+3 R', badge: 'TP' },
  ];
  const bars = [
    { symbol: 'XAUUSD', value: 1240 },
    { symbol: 'US100', value: 610 },
    { symbol: 'EURUSD', value: 260 },
  ];
  return (
    <Window>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map((row) => (
          <li key={row.symbol} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${row.pnl > 0 ? 'bg-buy-soft' : 'bg-sell-soft'}`}>
            <InstrumentBadge symbol={row.symbol} />
            <span className={`hidden rounded-md px-1.5 py-0.5 text-[10.5px] font-bold sm:inline ${row.side === 'LONG' ? 'bg-buy-soft text-buy' : 'bg-sell-soft text-sell'}`}>{row.side}</span>
            <span className="grow" />
            <span className="flex flex-col items-end">
              <span className={`font-mono text-sm font-bold whitespace-nowrap ${row.pnl > 0 ? 'text-buy' : 'text-sell'}`}>{formatAmount(row.pnl, 'USD')}</span>
              <span className="font-mono text-[11px] text-dim">{row.r}</span>
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${row.badge === 'TP' ? 'bg-buy-soft text-buy' : 'bg-sell-soft text-sell'}`}>{row.badge}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2.5 rounded-xl bg-raised p-3.5">
        <span className="text-xs text-dim">{t.byInstrument}</span>
        {bars.map((bar) => (
          <div key={bar.symbol} className="flex flex-col gap-1">
            <span className="flex items-center justify-between text-[13px]">
              <span className="flex items-center gap-2 font-semibold">
                <InstrumentLogo symbol={bar.symbol} size={18} />
                {bar.symbol}
              </span>
              <span className="font-mono font-semibold text-buy">{formatAmount(bar.value, 'USD')}</span>
            </span>
            <span className="h-1.5 overflow-hidden rounded-full bg-grid">
              <span className="block h-full rounded-full bg-buy" style={{ width: `${(bar.value / bars[0]!.value) * 100}%` }} />
            </span>
          </div>
        ))}
      </div>
    </Window>
  );
}

function MonitorVisual() {
  const all = useT();
  const t = all.landing.monitor;
  const slot = (time: string, value: string) => (
    <li className="flex min-h-13 min-w-0 flex-col justify-center rounded-xl bg-sell-soft px-2.5 py-1.5">
      <span className="text-[10.5px] font-bold text-dim">{time}</span>
      <span className="font-mono text-[13px] font-bold whitespace-nowrap text-sell">{value}</span>
    </li>
  );
  return (
    <Window>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[15px] font-bold">{all.landing.preview.monitor}</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-sell-soft px-2.5 py-1 text-[11px] font-bold text-sell">
          <span aria-hidden className="size-1.5 rounded-full bg-current" />
          {all.monitor.status.stop}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-xl font-bold tracking-tight text-sell">{t.verdict}</span>
        <span className="text-[13px] text-dim">
          {t.reason} · {all.monitor.resultToday} <span className="font-mono font-semibold text-sell">{formatAmount(-640, 'USD')}</span>
        </span>
      </div>
      <ol className="m-0 grid list-none grid-cols-2 gap-1.5 p-0 sm:grid-cols-4">
        {slot('09:12', '−1 R')}
        {slot('10:05', '−1 R')}
        {slot('11:40', '−0,8 R')}
        <li className="flex min-h-13 min-w-0 flex-col justify-center rounded-xl border-[1.5px] border-sell/50 bg-[repeating-linear-gradient(135deg,var(--sell-soft)_0_6px,transparent_6px_12px)] px-2.5 py-1.5">
          <span className="truncate text-[10.5px] font-bold text-dim">{t.over}</span>
          <span className="font-mono text-[13px] font-bold text-sell">+1</span>
        </li>
      </ol>
      <div className="flex items-center justify-between gap-3 text-[13px]">
        <span className="text-dim">{t.losses}</span>
        <span className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i} aria-hidden className="size-3.5 rounded-full border-2 border-sell bg-sell" />
          ))}
          <span className="ml-1 font-mono text-xs font-semibold text-sell">3 / 3</span>
        </span>
      </div>
      <div className="flex items-center gap-3 rounded-xl bg-raised px-3.5 py-2.5">
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-buy" />
        <span className="grow truncate text-[13px] font-bold">FTMO 100K</span>
        <span className="flex gap-1" aria-hidden>
          <span className="h-2 w-5 rounded-full bg-buy" />
          <span className="h-2 w-5 rounded-full bg-line" />
        </span>
        <span className="font-mono text-[13px] font-bold text-buy">{formatAmount(380, 'USD')}</span>
      </div>
    </Window>
  );
}

function CalculatorVisual() {
  const all = useT();
  const t = all.landing.calculator;
  const level = (label: string, cfd: string, fut: string, money: string, tone: string) => (
    <div className={`flex min-w-0 flex-col gap-1 rounded-xl p-3 ${tone}`}>
      <span className="text-xs font-bold">{label}</span>
      <span className="font-mono text-[11px] text-dim">US100 {cfd}</span>
      <span className="font-mono text-lg font-bold whitespace-nowrap">{fut}</span>
      <span className="truncate text-[11px] text-dim">{money}</span>
    </div>
  );
  return (
    <Window>
      <div className="grid grid-cols-1 items-center gap-2.5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-0.5 rounded-xl border-[1.5px] border-accent px-3.5 py-2.5">
          <span className="text-xs font-semibold text-dim">US100 · CFD</span>
          <span className="font-mono text-xl font-bold whitespace-nowrap sm:text-2xl">21 450,00</span>
        </div>
        <span aria-hidden className="flex size-10 items-center justify-center justify-self-center rounded-full bg-accent font-bold text-on-accent max-sm:rotate-90">
          ⇄
        </span>
        <div className="flex min-w-0 flex-col gap-0.5 rounded-xl bg-raised px-3.5 py-2.5">
          <span className="truncate text-xs font-semibold text-dim">NQ1 / MNQ1</span>
          <span className="font-mono text-xl font-bold whitespace-nowrap sm:text-2xl">21 512,25</span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {level(t.entry, '21 450', '21 512,25', 'NQ1 · MNQ1', 'bg-raised')}
        {level('SL', '21 410', '21 472,25', t.perContract('−$800'), 'bg-sell-soft')}
        {level('TP', '21 530', '21 592,25', t.perContract('+$1600'), 'bg-buy-soft')}
      </div>
    </Window>
  );
}
