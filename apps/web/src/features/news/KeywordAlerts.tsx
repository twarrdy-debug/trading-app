import { useState, type KeyboardEvent } from 'react';
import { useUpdateSettings } from '../../api/hooks.ts';
import { Chip, Input } from '../../components/ui/Field.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { useT } from '../../i18n/index.tsx';
import { loadAlertPrefs, saveAlertPrefs, type AlertPrefs } from '../../lib/news-live.ts';

/** Keyword list (saved to the account) and this browser's alert preferences. */
export function KeywordAlertsFields({ keywords }: { keywords: string[] }) {
  const t = useT().news;
  const update = useUpdateSettings();
  const [draft, setDraft] = useState('');
  const [prefs, setPrefs] = useState<AlertPrefs>(loadAlertPrefs);
  const [blocked, setBlocked] = useState(false);

  const save = (next: string[]) => update.mutate({ newsKeywords: next });
  const add = () => {
    const words = draft
      .split(',')
      .map((w) => w.trim())
      .filter((w) => w.length >= 2 && !keywords.some((k) => k.toLowerCase() === w.toLowerCase()));
    if (words.length) save([...keywords, ...words].slice(0, 30));
    setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  };
  const setPref = (patch: Partial<AlertPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveAlertPrefs(next);
  };
  const toggleNotify = async () => {
    if (prefs.notify) return setPref({ notify: false });
    if (typeof Notification === 'undefined') return setBlocked(true);
    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    setBlocked(permission !== 'granted');
    if (permission === 'granted') setPref({ notify: true });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-xs text-dim">{t.keywordsHelp}</p>
      {keywords.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {keywords.map((k) => (
            <span key={k} className="flex h-8 items-center gap-1 rounded-(--radius-chip) bg-accent/15 pr-1 pl-2.5 text-xs font-semibold">
              {k}
              <button
                type="button"
                onClick={() => save(keywords.filter((w) => w !== k))}
                aria-label={t.removeKeyword(k)}
                className="flex size-6 items-center justify-center rounded-md text-dim hover:bg-black/10 hover:text-ink"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={add} placeholder={t.keywordPlaceholder} maxLength={40} />
      <div className="flex flex-wrap gap-2">
        <Chip active={prefs.sound} onClick={() => setPref({ sound: !prefs.sound })}>
          {t.sound}
        </Chip>
        <Chip active={prefs.notify} onClick={() => void toggleNotify()}>
          {t.notifications}
        </Chip>
        <Chip active={prefs.red} onClick={() => setPref({ red: !prefs.red })}>
          <span className="size-2 rounded-full bg-breaking" aria-hidden />
          {t.redAlerts}
        </Chip>
      </div>
      {blocked && <p className="m-0 text-xs text-sell">{t.notificationsBlocked}</p>}
    </div>
  );
}

export function KeywordAlerts({ keywords }: { keywords: string[] }) {
  const t = useT().news;
  return (
    <Panel title={t.alerts} as="aside" className="pb-5">
      <div className="px-5">
        <KeywordAlertsFields keywords={keywords} />
      </div>
    </Panel>
  );
}
