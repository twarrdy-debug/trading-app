import type { PublicUser } from '@trading/api/types';
import { ACCENT_COLORS, AUTO_FX_CURRENCIES, LANGUAGES, type AccentKey, type Language, type Theme } from '@trading/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client.ts';
import { useUpdateSettings } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Field, Input, Segmented, toggleClass } from '../../components/ui/Field.tsx';
import { Select } from '../../components/ui/Select.tsx';
import { useT } from '../../i18n/index.tsx';
import { DEFAULT_ACCENT } from '../../lib/theme.ts';
import { AccountsManager } from '../account/AccountsManager.tsx';
import { InvitesManager } from '../auth/InvitesManager.tsx';

const TIMEZONES = ['Europe/Warsaw', 'Europe/London', 'America/New_York', 'America/Chicago', 'Asia/Tokyo', 'UTC'];

export function SettingsDialog({ user, onClose }: { user: PublicUser; onClose: () => void }) {
  const all = useT();
  const t = all.settings;
  const ref = useRef<HTMLDialogElement>(null);
  const update = useUpdateSettings();
  const s = user.settings;
  const [displayName, setDisplayName] = useState(user.displayName);
  const [currency, setCurrency] = useState(s.accountCurrency);
  const [timezone, setTimezone] = useState(s.timezone);
  const [limit, setLimit] = useState(s.maxTradesPerDay?.toString() ?? '');
  const [lossAlert, setLossAlert] = useState(String(s.lossStreakAlert));
  const [lossDaily, setLossDaily] = useState(s.lossAlertMode === 'day');
  const [theme, setTheme] = useState<Theme>(s.theme);
  const [language, setLanguage] = useState<Language>(s.language);
  const [accent, setAccent] = useState(s.accentColor ?? DEFAULT_ACCENT);

  useEffect(() => ref.current?.showModal(), []);

  const autoRate = (AUTO_FX_CURRENCIES as readonly string[]).includes(currency.toUpperCase());

  const submit = (e: FormEvent) => {
    e.preventDefault();
    update.mutate(
      {
        displayName,
        accountCurrency: currency,
        timezone,
        maxTradesPerDay: limit === '' ? null : Number(limit),
        lossStreakAlert: Number(lossAlert),
        lossAlertMode: lossDaily ? 'day' : 'streak',
        theme,
        language,
        accentColor: accent,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="settings-title"
      className="m-auto max-h-[calc(100dvh-32px)] w-[min(560px,calc(100vw-32px))] overflow-y-auto rounded-(--radius) border-0 bg-panel p-0 text-ink shadow-(--shadow-pop) backdrop:bg-black/40 backdrop:backdrop-blur-sm"
    >
      <form onSubmit={submit} className="flex flex-col gap-5 p-6">
        <h2 id="settings-title" className="m-0 text-lg font-bold">
          {t.title}
        </h2>

        <Field label={t.displayName}>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={80} />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t.currency} hint={autoRate ? t.autoRate : t.manualRate}>
            <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} pattern="[A-Za-z]{3}" required />
            <span role="group" aria-label={t.currency} className="flex gap-1">
              {AUTO_FX_CURRENCIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={currency === c}
                  onClick={() => setCurrency(c)}
                  className={`h-7 grow font-mono text-xs ${toggleClass(currency === c)}`}
                >
                  {c}
                </button>
              ))}
            </span>
          </Field>
          <Field label={t.timezone} help={t.timezoneHint}>
            <Select value={timezone} onChange={setTimezone} options={[...new Set([timezone, ...TIMEZONES])].map((tz) => ({ value: tz, label: tz }))} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t.dailyLimit} help={t.emptyNone}>
            <Input type="number" min={1} max={100} value={limit} onChange={(e) => setLimit(e.target.value)} />
          </Field>
          <Field label={t.lossStreakAlert} help={t.lossStreakHint}>
            <Input type="number" min={1} max={20} step={1} value={lossAlert} onChange={(e) => setLossAlert(e.target.value)} required />
          </Field>
        </div>

        <label className="-mt-1 flex cursor-pointer items-start gap-2.5 text-[13px]">
          <input
            type="checkbox"
            checked={lossDaily}
            onChange={(e) => setLossDaily(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 cursor-pointer accent-(--accent-ink)"
          />
          {t.lossAlertDay}
        </label>

        <AccountsManager currency={currency} />

        {user.role === 'admin' && <InvitesManager timezone={timezone} />}

        <div className="flex flex-col gap-2">
          <span className="eyebrow">{t.language}</span>
          <Segmented
            label={t.language}
            value={language}
            onChange={setLanguage}
            options={LANGUAGES.map((value) => ({ value, label: all.languageNames[value] }))}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="eyebrow">{t.theme}</span>
          <Segmented
            label={t.theme}
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'dark', label: all.nav.dark },
              { value: 'light', label: all.nav.light },
              { value: 'system', label: all.nav.system },
            ]}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="eyebrow">{t.accent}</span>
          <div role="group" aria-label={t.accent} className="flex flex-wrap gap-2">
            {(Object.keys(ACCENT_COLORS) as AccentKey[]).map((key) => {
              const color = ACCENT_COLORS[key];
              const active = color === accent.toUpperCase();
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setAccent(color)}
                  className={`flex h-10 items-center gap-2.5 px-3.5 text-[13px] ${toggleClass(active)}`}
                >
                  {/* Monochrome shows both halves: black details on light, white on dark. */}
                  <span
                    aria-hidden
                    className="size-4 rounded-full border border-black/15"
                    style={{ background: key === 'mono' ? 'linear-gradient(135deg, #18202b 50%, #ffffff 50%)' : color }}
                  />
                  {t.accents[key]}
                </button>
              );
            })}
          </div>
          <span className="text-xs text-dim">{t.accentHint}</span>
        </div>

        {update.error && (
          <ul className="m-0 list-none rounded-(--radius-control) bg-sell-soft p-3 text-sm text-sell">
            {(update.error instanceof ApiError ? update.error.lines : [update.error.message]).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}

        <div className="flex justify-end gap-3">
          <Button onClick={onClose}>{all.common.cancel}</Button>
          <Button type="submit" variant="primary" disabled={update.isPending}>
            {all.common.save}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
