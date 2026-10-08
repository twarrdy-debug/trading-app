import { useEffect, useId, useMemo, useState, type DragEvent } from 'react';
import { useT } from '../../i18n/index.tsx';

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const onlyImages = (files: Iterable<File>) => [...files].filter((f) => IMAGE_TYPES.includes(f.type));

interface Saved {
  id: string;
  url: string;
}

interface Props {
  /** Screenshots already saved with the trade (edit mode). */
  saved: Saved[];
  onRemoveSaved: (id: string) => void;
  /** Files chosen, dropped or pasted, uploaded when the trade is saved. */
  pending: File[];
  onAdd: (files: File[]) => void;
  onRemovePending: (index: number) => void;
}

/**
 * Chart screenshots: drop files here, paste one (Ctrl+V anywhere in the form, see TradeComposer) or
 * choose files; new ones show as thumbnails until the trade is saved.
 */
export function ScreenshotDrop({ saved, onRemoveSaved, pending, onAdd, onRemovePending }: Props) {
  const t = useT().composer;
  const id = useId();
  const [over, setOver] = useState(false);
  const previews = useMemo(() => pending.map((f) => URL.createObjectURL(f)), [pending]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const files = onlyImages(e.dataTransfer.files);
    if (files.length) onAdd(files);
  };
  const thumbs = [
    ...saved.map((s) => ({ key: s.id, url: s.url, label: s.url, remove: () => onRemoveSaved(s.id), isNew: false })),
    ...pending.map((f, i) => ({ key: `new-${i}-${f.name}`, url: previews[i]!, label: f.name, remove: () => onRemovePending(i), isNew: true })),
  ];

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold">{t.shots}</span>
      {thumbs.length > 0 && (
        <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0 sm:grid-cols-4">
          {thumbs.map((th) => (
            <li key={th.key} className="relative">
              <a href={th.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-(--radius-control) border border-line">
                <img src={th.url} alt={th.isNew ? t.shotPending : ''} className="block aspect-video w-full object-cover" />
              </a>
              <button
                type="button"
                aria-label={t.removeShot}
                onClick={th.remove}
                className="absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-lg bg-panel/90 text-sell shadow-sm"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={`flex min-h-16 flex-wrap items-center justify-center gap-1 rounded-(--radius-control) border border-dashed px-4 py-3 text-center text-[13px] transition ${
          over ? 'border-accent-ink bg-accent/10' : 'border-line text-dim'
        }`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mr-1">
          <rect x="3" y="5" width="18" height="14" rx="2.5" />
          <path d="m3 16 5-5 4 4 3-3 6 6" />
          <circle cx="15.5" cy="9.5" r="1.5" />
        </svg>
        {t.shotsHint}
        <label htmlFor={id} className="cursor-pointer font-semibold text-accent-ink underline-offset-2 hover:underline">
          {t.shotsChoose}
        </label>
        <input
          id={id}
          type="file"
          accept={IMAGE_TYPES.join(',')}
          multiple
          className="sr-only"
          onChange={(e) => {
            const files = onlyImages(e.target.files ?? []);
            if (files.length) onAdd(files);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
