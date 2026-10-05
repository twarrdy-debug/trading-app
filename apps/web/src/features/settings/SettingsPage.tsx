import type { PublicUser } from '@trading/api/types';
import {
  ACCENT_COLORS,
  ACCOUNT_CURRENCY_CHOICES,
  AUTO_FX_CURRENCIES,
  LANGUAGES,
  type AccentKey,
  type LossAlertMode,
  type Theme,
  type UpdateSettingsInput,
} from '@trading/shared';
import { Link, useParams } from '@tanstack/react-router';
import { useEffect, useId, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from 'react';
import { AuthError, authApi } from '../../api/auth.ts';
import { ApiError } from '../../api/client.ts';
import { useMe, useOnboarding, useUpdateSettings } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { FieldLabelContext, Input, Segmented, toggleClass } from '../../components/ui/Field.tsx';
import { Select } from '../../components/ui/Select.tsx';
import { useT } from '../../i18n/index.tsx';
import { DEFAULT_ACCENT } from '../../lib/theme.ts';
import { AccountsManager } from '../account/AccountsManager.tsx';
import { FavoriteInstrumentsPicker } from './FavoriteInstruments.tsx';
import { KeywordAlertsFields } from '../news/KeywordAlerts.tsx';

const TIMEZONES = ['Europe/Warsaw', 'Europe/London', 'America/New_York', 'America/Chicago', 'Asia/Tokyo', 'UTC'];

/** URL slug → section; the slugs are Polish like the other paths. */
const SECTIONS = [
  { slug: 'profil', key: 'profile' },
  { slug: 'wyglad', key: 'appearance' },
  { slug: 'waluta-i-czas', key: 'region' },
  { slug: 'dyscyplina', key: 'discipline' },
  { slug: 'konta', key: 'accounts' },
  { slug: 'instrumenty', key: 'instruments' },
  { slug: 'alerty', key: 'alerts' },
] as const;
type SectionKey = (typeof SECTIONS)[number]['key'];

type Save = (patch: UpdateSettingsInput) => void;

/** Settings page: section menu on the left, the chosen section on the right; every change saves itself. */
export function SettingsPage() {
  const all = useT();
  const t = all.settings;
  const { data: me } = useMe();
  const { section: slug } = useParams({ strict: false }) as { section?: string };
  const update = useUpdateSettings();
  const [savedAt, setSavedAt] = useState(0);
  const [showSaved, setShowSaved] = useState(false);

  // "Saved" stays for a moment after each save.
  useEffect(() => {
    if (!savedAt) return;
    setShowSaved(true);
    const id = setTimeout(() => setShowSaved(false), 2000);
    return () => clearTimeout(id);
  }, [savedAt]);

  if (!me) return <main className="grow p-8 text-dim">{all.common.loading}</main>;

  const sections = SECTIONS;
  const current = sections.find((s) => s.slug === slug) ?? sections[0]!;
  const save: Save = (patch) => update.mutate(patch, { onSuccess: () => setSavedAt(Date.now()) });

  return (
    <main className="mx-auto flex w-full max-w-6xl grow flex-col gap-5 p-4 md:px-8 md:py-6">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="m-0 text-2xl font-bold tracking-tight">{t.title}</h1>
        <span role="status" className="text-xs text-dim">
          {update.isPending ? t.saving : showSaved ? `✓ ${t.saved}` : t.autosave}
        </span>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
        <nav aria-label={t.sectionsLabel} className="lg:card -mx-4 flex gap-1 overflow-x-auto px-4 lg:sticky lg:top-28 lg:mx-0 lg:flex-col lg:p-2">
          {sections.map((s) => (
            <Link
              key={s.slug}
              to="/ustawienia/$section"
              params={{ section: s.slug }}
              aria-current={s === current ? 'page' : undefined}
              className={`shrink-0 rounded-[10px] px-3.5 py-2.5 text-sm no-underline transition ${
                s === current ? 'bg-panel font-bold text-ink shadow-sm lg:bg-chip lg:shadow-none' : 'font-medium text-dim hover:bg-chip hover:text-ink'
              }`}
            >
              {t.sections[s.key]}
            </Link>
          ))}
        </nav>

        <div className="flex min-w-0 flex-col gap-4">
          <header className="flex flex-col gap-1">
            <h2 className="m-0 text-lg font-bold">{t.sections[current.key]}</h2>
            <p className="m-0 max-w-2xl text-[13px] text-dim">{t.intros[current.key]}</p>
          </header>
          {update.error && (
            <ul role="alert" className="m-0 list-none rounded-(--radius-control) bg-sell-soft p-3 text-sm text-sell">
              {(update.error instanceof ApiError ? update.error.lines : [update.error.message]).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <Section section={current.key} user={me} save={save} />
        </div>
      </div>
    </main>
  );
}

function Section({ section, user, save }: { section: SectionKey; user: PublicUser; save: Save }) {
  switch (section) {
    case 'profile':
      return <ProfileSection user={user} save={save} />;
    case 'appearance':
      return <AppearanceSection user={user} save={save} />;
    case 'region':
      return <RegionSection user={user} save={save} />;
    case 'discipline':
      return <DisciplineSection user={user} save={save} />;
    case 'accounts':
      return (
        <Card padded>
          <AccountsManager currency={user.settings.accountCurrency} />
        </Card>
      );
    case 'instruments':
      return <FavoriteInstrumentsSection />;
    case 'alerts':
      return (
        <Card padded>
          <KeywordAlertsFields keywords={user.settings.newsKeywords} />
        </Card>
      );
  }
}

/** Favourite instruments as toggle pills (shared with the introduction). */
function FavoriteInstrumentsSection() {
  return (
    <Card padded>
      <FavoriteInstrumentsPicker />
    </Card>
  );
}

// --- Building blocks ---------------------------------------------------------

function Card({ padded, children }: { padded?: boolean; children: ReactNode }) {
  return <section className={`card ${padded ? 'p-5' : 'py-1'}`}>{children}</section>;
}

/** One setting: name and explanation on the left, the control on the right (stacked on phones). */
function Row({ label, help, htmlFor, children }: { label: string; help?: ReactNode; htmlFor?: string; children: ReactNode }) {
  const labelId = useId();
  return (
    <div className="grid gap-3 border-t border-line px-5 py-4 first:border-t-0 md:grid-cols-[minmax(0,1fr)_minmax(0,340px)] md:gap-8">
      <div className="flex flex-col gap-1">
        <label id={labelId} htmlFor={htmlFor} className="text-sm font-semibold">
          {label}
        </label>
        {help && <span className="text-xs text-dim">{help}</span>}
      </div>
      <div className="flex min-w-0 flex-col gap-2 md:items-end">
        <FieldLabelContext.Provider value={labelId}>{children}</FieldLabelContext.Provider>
      </div>
    </div>
  );
}

/**
 * Text input that saves when it loses focus (or on Enter), only when the value changed and passes
 * the input's own constraints (required, pattern, min/max).
 */
function AutoInput({
  value,
  onSave,
  transform = (v) => v,
  ...props
}: { value: string; onSave: (value: string) => void; transform?: (value: string) => string } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange'
>) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Input
      {...props}
      value={draft}
      onChange={(e) => setDraft(transform(e.target.value))}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      onBlur={(e) => {
        if (draft === value) return;
        if (e.currentTarget.checkValidity()) onSave(draft);
        else e.currentTarget.reportValidity();
      }}
    />
  );
}

// --- Sections ----------------------------------------------------------------

function ProfileSection({ user, save }: { user: PublicUser; save: Save }) {
  const t = useT().settings;
  const onboarding = useOnboarding();
  const id = useId();
  return (
    <>
      <Card>
        <Row label={t.displayName} help={t.displayNameHelp} htmlFor={`${id}-name`}>
          <AutoInput
            id={`${id}-name`}
            value={user.displayName}
            onSave={(v) => save({ displayName: v.trim() })}
            required
            maxLength={80}
            className="font-sans"
          />
        </Row>
        <Row label={t.email} help={t.emailHelp}>
          <span className="font-mono text-sm">{user.email}</span>
        </Row>
        <Row label={t.role}>
          <span className="rounded-(--radius-chip) bg-chip px-3 py-1 text-xs font-semibold">{t.roles[user.role] ?? user.role}</span>
        </Row>
        <Row label={t.onboarding} help={t.onboardingHelp}>
          <Button size="sm" onClick={() => onboarding.mutate('restart')} disabled={onboarding.isPending}>
            {t.onboardingRestart}
          </Button>
        </Row>
      </Card>
      {user.authenticated && <PasswordCard />}
    </>
  );
}

function PasswordCard() {
  const all = useT();
  const t = all.settings;
  const id = useId();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      await authApi.changePassword(current, next);
      setCurrent('');
      setNext('');
      setMessage({ ok: true, text: t.passwordChanged });
    } catch (err) {
      const code = err instanceof AuthError ? err.code : 'UNKNOWN';
      setMessage({ ok: false, text: all.auth.errors[code] ?? all.auth.errors.UNKNOWN! });
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <form onSubmit={(e) => void submit(e)}>
        <Row label={t.password} help={t.passwordHelp} htmlFor={`${id}-current`}>
          <Input
            id={`${id}-current`}
            type="password"
            autoComplete="current-password"
            placeholder={t.currentPassword}
            aria-label={t.currentPassword}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
          <Input
            type="password"
            autoComplete="new-password"
            placeholder={`${t.newPassword} (${all.auth.passwordHint})`}
            aria-label={t.newPassword}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            minLength={8}
            maxLength={128}
            required
          />
          <Button type="submit" size="sm" variant="primary" disabled={pending} className="self-end">
            {t.changePassword}
          </Button>
          {message && (
            <span role={message.ok ? 'status' : 'alert'} className={`text-[13px] ${message.ok ? 'text-buy' : 'text-sell'}`}>
              {message.text}
            </span>
          )}
        </Row>
      </form>
    </Card>
  );
}

function AppearanceSection({ user, save }: { user: PublicUser; save: Save }) {
  const all = useT();
  const t = all.settings;
  const s = user.settings;
  const accent = (s.accentColor ?? DEFAULT_ACCENT).toUpperCase();
  return (
    <Card>
      <Row label={t.theme} help={t.themeHelp}>
        <Segmented<Theme>
          label={t.theme}
          value={s.theme}
          onChange={(theme) => save({ theme })}
          options={[
            { value: 'light', label: all.nav.light },
            { value: 'dark', label: all.nav.dark },
            { value: 'system', label: all.nav.system },
          ]}
        />
      </Row>
      <Row label={t.accent} help={t.accentHint}>
        <div role="group" aria-label={t.accent} className="flex flex-wrap gap-2 md:justify-end">
          {(Object.keys(ACCENT_COLORS) as AccentKey[]).map((key) => {
            const color = ACCENT_COLORS[key];
            const active = color === accent;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => save({ accentColor: color })}
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
      </Row>
      <Row label={t.language} help={t.languageHelp}>
        <Segmented
          label={t.language}
          value={s.language}
          onChange={(language) => save({ language })}
          options={LANGUAGES.map((value) => ({ value, label: all.languageNames[value] }))}
        />
      </Row>
    </Card>
  );
}

function RegionSection({ user, save }: { user: PublicUser; save: Save }) {
  const t = useT().settings;
  const id = useId();
  const { accountCurrency: currency, timezone } = user.settings;
  const autoRate = (AUTO_FX_CURRENCIES as readonly string[]).includes(currency);
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = [...new Set([timezone, browserZone, ...TIMEZONES])];
  return (
    <Card>
      <Row label={t.currency} help={<>{t.currencyHelp} {autoRate ? t.autoRate : t.manualRate}</>}>
        <span role="group" aria-label={t.currency} className="flex flex-wrap gap-1 md:justify-end">
          {ACCOUNT_CURRENCY_CHOICES.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={currency === c}
              onClick={() => currency !== c && save({ accountCurrency: c })}
              className={`h-9 min-w-14 px-3 font-mono text-xs ${toggleClass(currency === c)}`}
            >
              {c}
            </button>
          ))}
        </span>
        <label className="flex items-center gap-2 text-xs whitespace-nowrap text-dim" htmlFor={`${id}-currency`}>
          {t.otherCurrency}
          <AutoInput
            id={`${id}-currency`}
            value={currency}
            onSave={(v) => save({ accountCurrency: v })}
            transform={(v) => v.toUpperCase()}
            maxLength={3}
            pattern="[A-Z]{3}"
            required
            className="h-9! w-20!"
          />
        </label>
      </Row>
      <Row label={t.timezone} help={t.timezoneHint}>
        <Select
          value={timezone}
          onChange={(tz) => tz !== timezone && save({ timezone: tz })}
          options={zones.map((tz) => ({ value: tz, label: tz === browserZone && tz !== timezone ? t.browserZone(tz) : tz }))}
        />
      </Row>
    </Card>
  );
}

function DisciplineSection({ user, save }: { user: PublicUser; save: Save }) {
  const t = useT().settings;
  const id = useId();
  const s = user.settings;
  return (
    <Card>
      <Row label={t.dailyLimit} help={t.dailyLimitHelp} htmlFor={`${id}-limit`}>
        <AutoInput
          id={`${id}-limit`}
          type="number"
          min={1}
          max={100}
          step={1}
          value={s.maxTradesPerDay?.toString() ?? ''}
          onSave={(v) => save({ maxTradesPerDay: v === '' ? null : Number(v) })}
          className="md:w-32!"
        />
      </Row>
      <Row label={t.lossStreakAlert} help={t.lossStreakHint} htmlFor={`${id}-losses`}>
        <AutoInput
          id={`${id}-losses`}
          type="number"
          min={1}
          max={20}
          step={1}
          required
          value={String(s.lossStreakAlert)}
          onSave={(v) => save({ lossStreakAlert: Number(v) })}
          className="md:w-32!"
        />
      </Row>
      <Row label={t.lossMode} help={t.lossModeHelp}>
        <Segmented<LossAlertMode>
          label={t.lossMode}
          value={s.lossAlertMode}
          onChange={(lossAlertMode) => save({ lossAlertMode })}
          options={[
            { value: 'streak', label: t.lossModes.streak },
            { value: 'day', label: t.lossModes.day },
          ]}
        />
      </Row>
    </Card>
  );
}
