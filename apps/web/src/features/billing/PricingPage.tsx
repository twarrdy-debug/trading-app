import { PRO_PRICES, type BillingCurrency, type BillingInterval } from '@trading/shared';
import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { ApiError } from '../../api/client.ts';
import { useBilling, useCheckout, useMe } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Segmented } from '../../components/ui/Field.tsx';
import { useLanguage, useT } from '../../i18n/index.tsx';
import { UpgradeLink } from '../plans/PlanLocked.tsx';

function Check({ muted = false }: { muted?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 ${muted ? 'text-dim' : 'text-buy'}`}>
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function Features({ items, muted }: { items: readonly string[]; muted?: boolean }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0 text-sm font-medium">
      {items.map((item) => (
        <li key={item} className="flex items-center gap-2.5">
          <Check muted={muted} />
          {item}
        </li>
      ))}
    </ul>
  );
}

function Price({ amount, per, note }: { amount: string; per?: string; note?: ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[2.75rem] leading-none font-extrabold tracking-tight">{amount}</span>
        {per && <span className="text-[15px] font-semibold text-dim">{per}</span>}
      </div>
      <p className="m-0 mt-2 min-h-5 text-[13px] font-medium text-dim">{note}</p>
    </div>
  );
}

/** The code to type on the payment page, copied with one click. */
function FoundersOffer({ code, left, money, price, yearPrice }: { code: string; left: number; money: (n: number) => string; price: number; yearPrice: number }) {
  const t = useT().billing;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The code stays readable on the button.
    }
  };
  return (
    <div className="flex flex-col gap-2.5 rounded-(--radius-control) bg-accent/10 px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-[13.5px] font-extrabold text-accent-ink">{t.foundersTitle(50)}</span>
        <span className="text-xs font-semibold text-dim">{t.seatsLeft(left)}</span>
      </div>
      <p className="m-0 text-sm font-medium">{t.foundersText(money(price), money(yearPrice))}</p>
      <button
        type="button"
        onClick={copy}
        aria-label={t.copyCode(code)}
        className="inline-flex h-11 items-center gap-2 self-start rounded-(--radius-chip) border border-dashed border-accent-ink px-3 text-[13.5px] font-extrabold tracking-wide transition hover:bg-accent/10"
      >
        {code}
        <span className="text-xs font-semibold text-dim" role="status">{copied ? t.copied : t.copy}</span>
      </button>
    </div>
  );
}

/** Standard against Pro with a month/year switch (concept A of the owner's mockups). */
export function PricingPage() {
  const all = useT();
  const t = all.billing;
  const language = useLanguage();
  const { data: me } = useMe();
  const { data: billing } = useBilling();
  const checkout = useCheckout();
  const [interval, setInterval] = useState<BillingInterval>('year');
  const currency: BillingCurrency = language === 'pl' ? 'pln' : 'usd';
  const prices = PRO_PRICES[currency];
  const money = t.money;
  const saving = Math.round((1 - prices.year / (prices.month * 12)) * 100);
  const isYear = interval === 'year';
  const standard = me?.role === 'standard';
  const error = checkout.error instanceof ApiError ? checkout.error.message : checkout.error ? t.error : null;

  return (
    <main className="page max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="m-0 text-3xl font-extrabold tracking-tight sm:text-4xl">{t.title}</h1>
          <p className="m-0 mt-2 text-[15px] text-dim">{t.subtitle}</p>
        </div>
        <Segmented
          label={t.period}
          value={interval}
          onChange={setInterval}
          options={[
            { value: 'month', label: t.monthly },
            { value: 'year', label: t.yearly(saving) },
          ]}
        />
      </div>

      <div className="grid items-stretch gap-5 md:grid-cols-2">
        <section className="card flex flex-col gap-5 p-6 sm:p-7">
          <div>
            <h2 className="m-0 text-xl font-extrabold">{t.standard}</h2>
            <p className="m-0 mt-1.5 text-sm text-dim">{t.standardText}</p>
          </div>
          <Price amount={money(0)} />
          <Button size="lg" disabled className="w-full">{standard ? t.currentPlan : t.standard}</Button>
          <Features items={t.standardFeatures} muted />
        </section>

        <section className="card order-first flex flex-col gap-5 p-6 ring-2 ring-accent ring-inset sm:p-7 md:order-none">
          <div>
            <h2 className="m-0 text-xl font-extrabold">{t.pro}</h2>
            <p className="m-0 mt-1.5 text-sm text-dim">{t.proText}</p>
          </div>
          <Price
            amount={money(isYear ? prices.year : prices.month)}
            per={isYear ? t.perYear : t.perMonth}
            note={isYear ? t.aboutMonthly(money(Math.round(prices.year / 12))) : t.yearCost(money(prices.month * 12))}
          />
          {isYear && billing?.canBuy && billing.founder.usable && (
            <FoundersOffer code={billing.founder.code} left={billing.founder.left} money={money} price={prices.founderYear} yearPrice={prices.year} />
          )}
          {billing?.canBuy ? (
            <Button variant="primary" size="lg" className="w-full" disabled={checkout.isPending} onClick={() => checkout.mutate({ interval, currency })}>
              {checkout.isPending ? t.opening : t.goPro}
            </Button>
          ) : standard ? (
            <UpgradeLink className="flex h-12 w-full items-center justify-center rounded-(--radius-control) bg-accent text-[15px] font-bold text-on-accent no-underline hover:brightness-105" />
          ) : (
            <Link to="/ustawienia/$section" params={{ section: 'subskrypcja' }} className="flex h-12 w-full items-center justify-center rounded-(--radius-control) border border-line bg-panel text-[15px] font-semibold text-ink no-underline hover:bg-raised">
              {t.manage}
            </Link>
          )}
          {error && <p role="alert" className="m-0 text-[13px] font-semibold text-sell">{error}</p>}
          <div className="flex flex-col gap-3">
            <span className="text-[13px] font-bold text-dim">{t.proIncludes}</span>
            <Features items={t.proFeatures} />
          </div>
        </section>
      </div>
    </main>
  );
}
