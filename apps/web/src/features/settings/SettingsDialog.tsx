import type { PublicUser } from '@trading/api/types';
import { AUTO_FX_CURRENCIES, type Theme } from '@trading/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client.ts';
import { useUpdateSettings } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Field, Input, Segmented, Select } from '../../components/ui/Field.tsx';
import { Brackets } from '../../components/ui/Panel.tsx';
import { ACCENT_OPTIONS, DEFAULT_ACCENT } from '../../lib/theme.ts';

const TIMEZONES = ['Europe/Warsaw', 'Europe/London', 'America/New_York', 'America/Chicago', 'Asia/Tokyo', 'UTC'];

export function SettingsDialog({ user, onClose }: { user: PublicUser; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const update = useUpdateSettings();
  const s = user.settings;
  const [displayName, setDisplayName] = useState(user.displayName);
  const [currency, setCurrency] = useState(s.accountCurrency);
  const [timezone, setTimezone] = useState(s.timezone);
  const [limit, setLimit] = useState(s.maxTradesPerDay?.toString() ?? '');
  const [theme, setTheme] = useState<Theme>(s.theme);
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
        theme,
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
      className="m-auto w-[min(560px,calc(100vw-32px))] overflow-visible border border-line bg-panel p-0 text-ink backdrop:bg-black/60"
    >
      <Brackets />
      <form onSubmit={submit} className="flex flex-col gap-5 p-6">
        <h2 id="settings-title" className="m-0 text-[13px] font-semibold tracking-[0.16em] uppercase">
          Ustawienia
        </h2>

        <Field label="Nazwa wyświetlana">
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={80} />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Waluta konta" hint={autoRate ? 'kurs automatyczny' : 'kurs ręczny'}>
            <Input
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              list="currencies"
              maxLength={3}
              pattern="[A-Za-z]{3}"
              required
            />
            <datalist id="currencies">
              {AUTO_FX_CURRENCIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Limit transakcji dziennie" hint="puste = brak">
            <Input type="number" min={1} max={100} value={limit} onChange={(e) => setLimit(e.target.value)} />
          </Field>
        </div>

        <Field label="Strefa czasowa" hint="wyznacza dzień transakcji">
          <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {[...new Set([timezone, ...TIMEZONES])].map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </Field>

        <div className="flex flex-col gap-2">
          <span className="eyebrow">Motyw</span>
          <Segmented
            label="Motyw"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'dark', label: 'Ciemny' },
              { value: 'light', label: 'Jasny' },
              { value: 'system', label: 'Systemowy' },
            ]}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="eyebrow">Kolor wiodący</span>
          <div className="flex items-center gap-3">
            {ACCENT_OPTIONS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Kolor ${color}`}
                aria-pressed={color.toLowerCase() === accent.toLowerCase()}
                onClick={() => setAccent(color)}
                className="size-6 rotate-45 border border-line p-0"
                style={{
                  background: color,
                  boxShadow: color.toLowerCase() === accent.toLowerCase() ? `0 0 0 2px var(--panel), 0 0 0 4px ${color}` : 'none',
                }}
              />
            ))}
            <label className="ml-2 flex items-center gap-2 font-mono text-xs text-dim">
              własny
              <input
                type="color"
                value={accent}
                onChange={(e) => setAccent(e.target.value.toUpperCase())}
                className="h-8 w-10 cursor-pointer border border-line bg-transparent p-0.5"
              />
            </label>
          </div>
        </div>

        {update.error && (
          <ul className="m-0 list-none border border-sell p-3 text-sm text-sell">
            {(update.error instanceof ApiError ? update.error.lines : [update.error.message]).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}

        <div className="flex justify-end gap-3">
          <Button onClick={onClose}>Anuluj</Button>
          <Button type="submit" variant="primary" disabled={update.isPending}>
            Zapisz
          </Button>
        </div>
      </form>
    </dialog>
  );
}
