import { SUPPORT_EMAIL, type Feature } from '@trading/shared';
import type { ReactNode } from 'react';
import { useMe } from '../../api/hooks.ts';
import { LockedPreview } from '../../components/ui/LockedPreview.tsx';
import { useT } from '../../i18n/index.tsx';
import { DemoLocked } from '../demo/Demo.tsx';

/** Whether the user's plan includes a feature (true until /me arrives, so nothing flashes locked). */
export function useFeature(feature: Feature) {
  const { data: me } = useMe();
  return !me || me.plan.features.includes(feature);
}

/**
 * A screen outside the user's plan: the blurred outline under a lock, saying it is part of Pro and
 * VIP, with a way to ask for it (there are no payments yet: an admin gives the role).
 */
export function PlanLocked({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  const t = useT().plans;
  return (
    <LockedPreview
      title={title}
      text={text}
      eyebrow={t.eyebrow}
      actions={
        <a
          href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(t.askSubject)}`}
          className="inline-flex h-11 items-center rounded-(--radius-control) bg-accent px-5 text-sm font-bold text-on-accent no-underline hover:brightness-105"
        >
          {t.ask}
        </a>
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
