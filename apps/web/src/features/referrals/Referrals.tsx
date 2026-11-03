import type { AdminPartner } from '@trading/api/types';
import { type BillingCurrency, REFERRAL_DEFAULT_PERCENT, REFERRAL_HOLD_DAYS, REFERRAL_MONTHS, type ReferralStatus } from '@trading/shared';
import { useState, type ReactNode } from 'react';
import { ApiError } from '../../api/client.ts';
import { useAdminPartners, useCreatePartner, usePartnerPayout, useReferrals, useUpdatePartner } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Field, Input } from '../../components/ui/Field.tsx';
import { useT } from '../../i18n/index.tsx';
import { currentLocale, formatAmount } from '../../lib/format.ts';

const money = (value: number, currency: string) => formatAmount(value, currency.toUpperCase(), false);
const day = (value: string) => new Intl.DateTimeFormat(currentLocale(), { dateStyle: 'medium' }).format(new Date(value));

type Totals = { currency: BillingCurrency; ready: number; waiting: number; paidOut: number };
/** Złoty first, and always one line, so an empty panel still says what will appear. */
const inOrder = (totals: Totals[]): Totals[] => {
  const sorted = [...totals].sort((a, b) => a.currency.localeCompare(b.currency));
  return sorted.length > 0 ? sorted : [{ currency: 'pln', ready: 0, waiting: 0, paidOut: 0 }];
};

const TONES: Record<ReferralStatus, string> = {
  waiting: 'bg-warn-bg text-warn',
  ready: 'bg-buy-soft text-buy',
  paidOut: 'bg-chip text-dim',
  refunded: 'bg-sell-soft text-sell',
  clawback: 'bg-sell-soft text-sell',
};
const Pill = ({ tone, children }: { tone: ReferralStatus; children: ReactNode }) => (
  <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold whitespace-nowrap ${TONES[tone]}`}>{children}</span>
);

function CopyButton({ value, label, primary }: { value: string; label: string; primary?: boolean }) {
  const t = useT().referrals;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Button variant={primary ? 'primary' : 'secondary'} className="flex-1 whitespace-nowrap" onClick={() => void copy()}>
      {copied ? t.copied : label}
    </Button>
  );
}

/** One currency: the amount to come first, then how the money splits. */
function Earnings({ totals, main }: { totals: Totals; main: boolean }) {
  const t = useT().referrals;
  const { currency, ready, waiting, paidOut } = totals;
  const all = Math.max(ready, 0) + waiting + paidOut;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        <span className="text-[13px] font-semibold text-dim">{t.ready}</span>
        <div className={`font-extrabold tracking-tight text-buy tabular-nums ${main ? 'text-[clamp(2.25rem,6cqw,3.25rem)] leading-tight' : 'text-3xl'}`}>{money(ready, currency)}</div>
      </div>
      {all > 0 && (
        <div className="flex h-3 overflow-hidden rounded-full bg-chip" aria-hidden>
          <span className="bg-dim/50" style={{ flex: paidOut }} />
          <span className="bg-buy" style={{ flex: Math.max(ready, 0) }} />
          <span className="bg-accent" style={{ flex: waiting }} />
        </div>
      )}
      <div className="flex flex-wrap gap-x-7 gap-y-2 text-[13px] font-semibold text-dim">
        <span>{t.paidOut} <strong className="text-ink">{money(paidOut, currency)}</strong></span>
        <span>{t.waitingDays(REFERRAL_HOLD_DAYS)} <strong className="text-warn">{money(waiting, currency)}</strong></span>
      </div>
    </div>
  );
}

/** Settings → Referrals, for partners: what is due first, then the link, then the purchases. */
export function PartnerSection() {
  const all = useT();
  const t = all.referrals;
  const { data, isLoading } = useReferrals();
  const partner = data?.partner;
  if (isLoading) return <p className="m-0 text-sm text-dim">{all.common.loading}</p>;
  if (!partner) return null;
  const link = `${window.location.origin}/r/${partner.code}`;

  return (
    <div className="flex flex-col gap-4">
      {!partner.active && <p className="m-0 rounded-(--radius-control) bg-warn-bg px-4 py-3 text-sm font-semibold text-warn">{t.inactive}</p>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="card @container flex flex-col gap-7 p-5 sm:p-7">
          {inOrder(partner.totals).map((totals, i) => (
            <Earnings key={totals.currency} totals={totals} main={i === 0} />
          ))}
        </section>
        <section className="card flex flex-col gap-3 p-5 sm:p-6">
          <span className="text-[13px] font-semibold text-dim">{t.link}</span>
          <span className="rounded-(--radius-control) bg-chip px-3.5 py-3 text-[15px] font-extrabold break-all">{link.replace(/^https?:\/\//, '')}</span>
          <div className="flex flex-wrap gap-2">
            <CopyButton primary value={link} label={t.copyLink} />
            <CopyButton value={partner.code} label={t.copyCode(partner.code)} />
          </div>
          <p className="m-0 text-[13px] font-semibold">{t.funnel(partner.signups, partner.customers)}</p>
          <p className="m-0 text-[13px] text-dim">{t.linkHelp}</p>
        </section>
      </div>
      <section className="card flex flex-col py-2">
        <h3 className="m-0 px-5 py-3 text-base font-extrabold sm:px-6">{t.sales}</h3>
        {partner.sales.length === 0 ? (
          <p className="m-0 border-t border-line px-5 py-4 text-sm text-dim sm:px-6">{t.noSales}</p>
        ) : (
          partner.sales.map((sale) => (
            <div key={sale.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line px-5 py-3 sm:px-6">
              <div className="min-w-48 flex-1">
                <strong className="block text-sm font-extrabold">{sale.status === 'clawback' ? t.status.clawback : t.plans[sale.plan]}</strong>
                <span className="text-xs text-dim">{day(sale.paidAt)}{sale.paid > 0 && ` · ${t.paidAmount(money(sale.paid, sale.currency))}`}</span>
              </div>
              <Pill tone={sale.status}>{sale.status === 'waiting' ? t.status.waitingUntil(day(sale.availableAt)) : t.status[sale.status]}</Pill>
              <strong className="min-w-24 text-right text-[15px] font-extrabold whitespace-nowrap tabular-nums">{money(sale.commission, sale.currency)}</strong>
            </div>
          ))
        )}
      </section>
      <p className="m-0 text-[13px] text-dim">{t.rules(partner.percent, REFERRAL_MONTHS, REFERRAL_HOLD_DAYS)}</p>
    </div>
  );
}

function PayoutButton({ partner, totals }: { partner: AdminPartner; totals: Totals }) {
  const t = useT().referrals;
  const payout = usePartnerPayout();
  const [sure, setSure] = useState(false);
  if (totals.ready <= 0) return null;
  const amount = money(totals.ready, totals.currency);
  return (
    <Button
      size="sm"
      variant={sure ? 'primary' : 'secondary'}
      disabled={payout.isPending}
      className="whitespace-nowrap"
      onBlur={() => setSure(false)}
      onClick={() => {
        if (!sure) return setSure(true);
        setSure(false);
        payout.mutate({ id: partner.userId, currency: totals.currency });
      }}
    >
      {sure ? t.confirmPaid(amount) : t.markPaid}
    </Button>
  );
}

function PartnerRow({ partner, onError }: { partner: AdminPartner; onError: (err: unknown) => void }) {
  const t = useT().referrals;
  const update = useUpdatePartner();
  const [percent, setPercent] = useState(String(partner.percent));
  const totals = inOrder(partner.totals);
  const savePercent = () => {
    const value = Number(percent);
    if (!Number.isInteger(value) || value < 1 || value > 100) return setPercent(String(partner.percent));
    if (value !== partner.percent) update.mutate({ id: partner.userId, percent: value }, { onError });
  };
  const actions = (
    <>
      {totals.map((row) => <PayoutButton key={row.currency} partner={partner} totals={row} />)}
      <Button size="sm" variant="ghost" className="whitespace-nowrap" disabled={update.isPending} onClick={() => update.mutate({ id: partner.userId, active: !partner.active }, { onError })}>
        {partner.active ? t.turnOff : t.turnOn}
      </Button>
    </>
  );
  return (
    <tr className="border-t border-line align-top">
      <td className="px-4 py-3">
        <strong className="block font-bold">{partner.name}</strong>
        <span className="block text-xs break-all text-dim">{partner.email}</span>
        <span className="mt-1 flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-bold">{partner.code}</span>
          {!partner.active && <span className="rounded-full bg-chip px-2 py-0.5 text-xs font-bold text-dim">{t.off}</span>}
        </span>
        <span className="mt-1 block text-xs text-dim @min-[52rem]:hidden">{t.funnel(partner.signups, partner.customers)}</span>
        <span className="mt-2 flex flex-col gap-0.5 text-xs text-dim @min-[40rem]:hidden">
          {totals.map((row) => (
            <span key={row.currency}>{t.waiting} {money(row.waiting, row.currency)} · {t.paidOut} {money(row.paidOut, row.currency)}</span>
          ))}
        </span>
        {/* Narrow: the amount to pay and the actions move under the name, so nothing scrolls sideways. */}
        <span className="mt-3 flex flex-col gap-0.5 @min-[30rem]:hidden">
          <span className="text-xs text-dim">{t.percent}: {partner.percent}%</span>
          {totals.map((row) => (
            <span key={row.currency} className="text-sm font-bold text-buy">{t.ready}: {money(row.ready, row.currency)}</span>
          ))}
        </span>
        <span className="mt-2 flex flex-wrap gap-1.5 @min-[30rem]:hidden">{actions}</span>
      </td>
      <td className="hidden px-4 py-3 @min-[30rem]:table-cell">
        <Input
          aria-label={`${t.percent}: ${partner.name}`}
          inputMode="numeric"
          value={percent}
          onChange={(e) => setPercent(e.target.value.replace(/\D/g, ''))}
          onBlur={savePercent}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          className="w-16 text-right"
        />
      </td>
      <td className="hidden px-4 py-3 text-right font-mono @min-[52rem]:table-cell">{partner.signups}</td>
      <td className="hidden px-4 py-3 text-right font-mono @min-[52rem]:table-cell">{partner.customers}</td>
      <td className="hidden px-4 py-3 text-right font-mono whitespace-nowrap @min-[40rem]:table-cell">
        {totals.map((row) => <span key={row.currency} className="block">{money(row.waiting, row.currency)}</span>)}
      </td>
      <td className="hidden px-4 py-3 text-right font-mono whitespace-nowrap @min-[46rem]:table-cell">
        {totals.map((row) => <span key={row.currency} className="block">{money(row.paidOut, row.currency)}</span>)}
      </td>
      <td className="hidden px-4 py-3 text-right font-mono font-bold whitespace-nowrap text-buy @min-[30rem]:table-cell">
        {totals.map((row) => <span key={row.currency} className="block">{money(row.ready, row.currency)}</span>)}
      </td>
      <td className="hidden px-4 py-3 @min-[30rem]:table-cell">
        <div className="flex flex-col items-end gap-1.5">{actions}</div>
      </td>
    </tr>
  );
}

/** Admin → Partners: who may refer, at what share, and what is due to each. */
export function AdminPartners() {
  const all = useT();
  const t = all.referrals;
  const { data: partners, isLoading } = useAdminPartners();
  const create = useCreatePartner();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [percent, setPercent] = useState(String(REFERRAL_DEFAULT_PERCENT));
  const [error, setError] = useState<string | null>(null);
  const fail = (err: unknown) => setError(err instanceof ApiError ? err.message : t.error);

  return (
    <div className="flex flex-col gap-4">
      <form
        className="card grid items-end gap-3 p-5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_6rem_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          create.mutate(
            { email: email.trim(), code, percent: Number(percent) },
            {
              onSuccess: () => {
                setEmail('');
                setCode('');
                setPercent(String(REFERRAL_DEFAULT_PERCENT));
              },
              onError: fail,
            },
          );
        }}
      >
        <Field label={t.addEmail}>
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="font-sans" />
        </Field>
        <Field label={t.code}>
          <Input required minLength={3} maxLength={20} value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))} />
        </Field>
        <Field label={t.percent}>
          <Input inputMode="numeric" required value={percent} onChange={(e) => setPercent(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Button type="submit" variant="primary" disabled={create.isPending || Number(percent) < 1 || Number(percent) > 100}>{t.add}</Button>
      </form>
      {error && <p role="alert" className="m-0 text-[13px] font-semibold text-sell">{error}</p>}
      <section className="card @container flex flex-col overflow-hidden">
        {isLoading ? (
          <p className="m-0 p-5 text-sm text-dim">{all.common.loading}</p>
        ) : !partners?.length ? (
          <p className="m-0 p-5 text-sm text-dim">{t.noPartners}</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="bg-raised">
              <tr className="text-left text-xs text-dim">
                <th scope="col" className="px-4 py-2.5 font-semibold">{t.columns.partner}</th>
                <th scope="col" className="hidden px-4 py-2.5 font-semibold @min-[30rem]:table-cell">{t.percent}</th>
                <th scope="col" className="hidden px-4 py-2.5 text-right font-semibold @min-[52rem]:table-cell">{t.columns.signups}</th>
                <th scope="col" className="hidden px-4 py-2.5 text-right font-semibold @min-[52rem]:table-cell">{t.columns.customers}</th>
                <th scope="col" className="hidden px-4 py-2.5 text-right font-semibold @min-[40rem]:table-cell">{t.waiting}</th>
                <th scope="col" className="hidden px-4 py-2.5 text-right font-semibold @min-[46rem]:table-cell">{t.paidOut}</th>
                <th scope="col" className="hidden px-4 py-2.5 text-right font-semibold @min-[30rem]:table-cell">{t.ready}</th>
                <th scope="col" className="hidden w-px px-4 py-2.5 @min-[30rem]:table-cell"><span className="sr-only">{t.columns.actions}</span></th>
              </tr>
            </thead>
            <tbody>
              {partners.map((partner) => <PartnerRow key={partner.userId} partner={partner} onError={fail} />)}
            </tbody>
          </table>
        )}
      </section>
      <p className="m-0 text-[13px] text-dim">{t.adminHelp(REFERRAL_HOLD_DAYS)}</p>
    </div>
  );
}
