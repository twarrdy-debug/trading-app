import type { PublicUser } from '@trading/api/types';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ApiError } from '../../api/client.ts';
import { useBilling, usePortal } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { useT } from '../../i18n/index.tsx';
import { currentLocale } from '../../lib/format.ts';
import { UpgradeLink } from '../plans/PlanLocked.tsx';

const longDate = (value: Date | string) => new Intl.DateTimeFormat(currentLocale(), { dateStyle: 'long' }).format(new Date(value));

type Tone = 'buy' | 'sell' | 'neutral' | 'accent';
const TONES: Record<Tone, string> = {
  buy: 'bg-buy-soft text-buy',
  sell: 'bg-sell-soft text-sell',
  neutral: 'bg-chip text-dim',
  accent: 'bg-accent/10 text-accent-ink',
};
const Badge = ({ tone, children }: { tone: Tone; children: ReactNode }) => <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${TONES[tone]}`}>{children}</span>;

function Row({ title, badges, text, action }: { title: string; badges?: ReactNode; text: string; action?: ReactNode }) {
  return (
    <section className="card flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
      <div className="min-w-[16rem] flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="m-0 text-base font-extrabold">{title}</h2>
          {badges}
        </div>
        <p className="m-0 mt-1.5 text-[13.5px] font-medium text-dim">{text}</p>
      </div>
      {action}
    </section>
  );
}

/** Settings → Subscription: what the user has now; cards, invoices and cancelling are on Stripe's page. */
export function SubscriptionSection({ user }: { user: PublicUser }) {
  const t = useT().billing;
  const client = useQueryClient();
  const { data: billing } = useBilling();
  const portal = usePortal();
  const sub = billing?.subscription;
  const active = sub?.active ?? false;
  // Back from the payment page: Stripe's confirmation reaches the server a moment later.
  const [justPaid] = useState(() => new URLSearchParams(window.location.search).get('checkout') === 'done');
  useEffect(() => {
    if (!justPaid || active) return;
    const id = setInterval(() => void client.invalidateQueries({ queryKey: ['billing'] }), 2000);
    const stop = setTimeout(() => clearInterval(id), 30_000);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [justPaid, active, client]);
  useEffect(() => {
    if (active) void client.invalidateQueries({ queryKey: ['me'] });
  }, [active, client]);

  const manage = (label: string, primary = false) => (
    <Button variant={primary ? 'primary' : 'secondary'} disabled={portal.isPending} onClick={() => portal.mutate()}>
      {portal.isPending ? t.opening : label}
    </Button>
  );
  const planName = sub?.interval === 'year' ? t.proYearly : t.proMonthly;

  return (
    <div className="flex flex-col gap-4">
      {justPaid && (
        <p role="status" className="m-0 rounded-(--radius-control) bg-buy-soft px-4 py-3 text-sm font-semibold text-buy">
          {active ? t.paid : t.confirming}
        </p>
      )}
      {sub?.active ? (
        sub.status === 'past_due' ? (
          <Row title={planName} badges={<Badge tone="sell">{t.failed}</Badge>} text={t.failedText} action={manage(t.updateCard, true)} />
        ) : sub.cancelAtPeriodEnd ? (
          <Row title={planName} badges={<Badge tone="neutral">{t.ending}</Badge>} text={t.endingText(sub.currentPeriodEnd ? longDate(sub.currentPeriodEnd) : '')} action={manage(t.resume)} />
        ) : (
          <Row
            title={planName}
            badges={
              <>
                <Badge tone="buy">{t.activeBadge}</Badge>
                {sub.founder && <Badge tone="accent">{billing?.founder.code}</Badge>}
              </>
            }
            text={sub.currentPeriodEnd ? t.renews(longDate(sub.currentPeriodEnd)) : t.manageHelp}
            action={manage(t.manage)}
          />
        )
      ) : user.role === 'standard' ? (
        <Row
          title={t.planStandard}
          text={user.plan.tradeLimit != null ? t.standardUse(user.plan.tradeLimit) : t.standardText}
          action={
            billing?.available ? (
              <Link to="/plany" className="inline-flex h-11 items-center rounded-(--radius-control) bg-accent px-4 text-sm font-bold text-on-accent no-underline hover:brightness-105">
                {t.seePlans}
              </Link>
            ) : (
              <UpgradeLink className="inline-flex h-11 items-center rounded-(--radius-control) bg-accent px-4 text-sm font-bold text-on-accent no-underline hover:brightness-105" />
            )
          }
        />
      ) : (
        <Row title={t.planFull} badges={<Badge tone="buy">{t.freeBadge}</Badge>} text={t.freeText} />
      )}
      {sub?.active && <p className="m-0 text-[13px] text-dim">{t.manageHelp}</p>}
      {portal.error && <p role="alert" className="m-0 text-[13px] font-semibold text-sell">{portal.error instanceof ApiError ? portal.error.message : t.error}</p>}
    </div>
  );
}
