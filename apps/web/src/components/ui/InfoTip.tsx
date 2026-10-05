import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../i18n/index.tsx';

/** What a metric shows, how it is computed, how to read it and where the data comes from. */
export interface InfoContent {
  title: string;
  what: string;
  how: string;
  scale?: readonly string[];
  source?: string;
}

const WIDTH = 340;

/**
 * "?" button that opens an explanation card: on hover, on keyboard focus or on click (touch).
 * Escape, a click outside or moving away closes it.
 */
export function InfoTip({ info }: { info: InfoContent }) {
  const t = useT().info;
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const closeTimer = useRef<number | undefined>(undefined);

  const show = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  // A short delay lets the pointer travel from the button to the card.
  const hide = () => {
    if (pinned) return;
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };
  const close = () => {
    setPinned(false);
    setOpen(false);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const box = buttonRef.current?.getBoundingClientRect();
    if (!box) return;
    const width = Math.min(WIDTH, window.innerWidth - 16);
    const left = Math.min(Math.max(8, box.left + box.width / 2 - width / 2), window.innerWidth - width - 8);
    const height = cardRef.current?.offsetHeight ?? 0;
    // Below the button, or above it when there is no room below.
    const below = box.bottom + 8;
    const top = below + height > window.innerHeight - 8 && box.top - height - 8 > 8 ? box.top - height - 8 : below;
    setPosition({ left, top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!cardRef.current?.contains(target) && !buttonRef.current?.contains(target)) close();
    };
    const onScroll = () => close();
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={t.button(info.title)}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (pinned ? close() : (setPinned(true), show()))}
        onPointerEnter={(e) => e.pointerType === 'mouse' && show()}
        onPointerLeave={(e) => e.pointerType === 'mouse' && hide()}
        onFocus={show}
        onBlur={hide}
        className={`inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border text-[10px] leading-none font-bold transition ${
          open ? 'border-accent-ink text-accent-ink' : 'border-dim/50 text-dim hover:border-ink hover:text-ink'
        }`}
      >
        ?
      </button>
      {open &&
        createPortal(
          <div
            ref={cardRef}
            id={id}
            role="dialog"
            aria-label={info.title}
            onPointerEnter={show}
            onPointerLeave={(e) => e.pointerType === 'mouse' && hide()}
            className="fixed z-50 flex flex-col gap-3 rounded-(--radius-control) border border-line bg-panel p-4 text-left text-[13px] leading-relaxed font-normal text-ink shadow-(--shadow-pop)"
            style={{ ...position, width: Math.min(WIDTH, window.innerWidth - 16) }}
          >
            <strong className="text-sm">{info.title}</strong>
            <Section label={t.what}>{info.what}</Section>
            <Section label={t.how}>{info.how}</Section>
            {info.scale && (
              <Section label={t.scale}>
                <ul className="m-0 flex list-disc flex-col gap-1 pl-4">
                  {info.scale.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </Section>
            )}
            {info.source && <Section label={t.source}>{info.source}</Section>}
          </div>,
          document.body,
        )}
    </>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-semibold text-dim">{label}</span>
      <div>{children}</div>
    </div>
  );
}
