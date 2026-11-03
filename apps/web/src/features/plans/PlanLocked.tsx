import { SUPPORT_EMAIL, type Feature } from '@trading/shared';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useBilling, useMe } from '../../api/hooks.ts';
import { LockedPreview } from '../../components/ui/LockedPreview.tsx';
import { useT } from '../../i18n/index.tsx';
import { DemoLocked } from '../demo/Demo.tsx';

/** Whether the user's plan includes a feature (true until /me arrives, so nothing flashes locked). */
export function useFeature(feature: Feature) {
  const { data: me } = useMe();
  return !me || me.plan.features.includes(feature);
}

/** The way to Pro: the plans while payments are on, else an e-mail asking for it (an admin gives the role). */
export function UpgradeLink({ className }: { className: string }) {
  const all = useT();
  const { data: billing } = useBilling();
  if (billing?.available) {
    return (
      <Link to="/plany" className={className}>
        {all.billing.seePlans}
      </Link>
    );
  }
  return (
    <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(all.plans.askSubject)}`} className={className}>
      {all.plans.ask}
    </a>
  );
}

/** A screen outside the user's plan: the blurred outline under a lock, saying it is part of Pro and VIP. */
export function PlanLocked({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  const all = useT();
  const t = all.plans;
  const { data: billing } = useBilling();
  return (
    <LockedPreview
      title={title}
      text={text}
      eyebrow={t.eyebrow}
      actions={
        <>
          <UpgradeLink className="inline-flex h-11 items-center rounded-(--radius-control) bg-accent px-5 text-sm font-bold text-on-accent no-underline hover:brightness-105" />
          {billing?.canBuy && billing.founder.usable && <p className="m-0 w-full text-[13px] font-semibold text-accent-ink">{all.billing.foundersLine(billing.founder.code)}</p>}
        </>
      }
    >
      {children ?? (
        <>
          <div className="card h-24" />
          <div className="card h-[30rem]" style={{ background: 'var(--chart-bg)' }} />
        </>
      )}
    </LockedPreview>
  );
}

/**
 * A screen of the Pro plans: shown as is when the plan has it, locked for Standard, and locked the
 * demo's way in the demo (its own wording and sign-up buttons).
 */
export function PlanGate({
  feature,
  demo,
  plan,
  children,
}: {
  feature: Feature;
  demo: { title: string; text: string };
  plan: { title: string; text: string };
  children: ReactNode;
}) {
  const { data: me } = useMe();
  const allowed = useFeature(feature);
  if (me?.demo) return <DemoLocked title={demo.title} text={demo.text} />;
  if (!allowed) return <PlanLocked title={plan.title} text={plan.text} />;
  return <>{children}</>;
}
