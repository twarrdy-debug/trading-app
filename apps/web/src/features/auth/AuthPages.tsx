import { LANGUAGES } from '@trading/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent, type ReactNode } from 'react';
import { AuthError, authApi, useAuthConfig, useResetSession } from '../../api/auth.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Field, Input } from '../../components/ui/Field.tsx';
import { useLanguage, useSetLanguage, useT } from '../../i18n/index.tsx';
import { APP_NAME } from '../../layout/AppShell.tsx';

const query = () => new URLSearchParams(window.location.search);

/** Only same-app paths, so a crafted link cannot send the user elsewhere after signing in. */
const safeNext = (value: string | null) => (value && value.startsWith('/') && !value.startsWith('//') ? value : '/');

function useErrorText() {
  const t = useT().auth;
  return (err: unknown) => t.errors[err instanceof AuthError ? err.code : 'UNKNOWN'] ?? t.errors.UNKNOWN!;
}

/** Centered card with the logo and a language switch, shared by the signed-out pages. */
function AuthLayout({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  const all = useT();
  const language = useLanguage();
  const setLanguage = useSetLanguage();
  return (
    <main className="flex min-h-full items-center justify-center p-4">
      <div className="flex w-full max-w-[420px] flex-col gap-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-[10px] bg-accent">
              <svg width="20" height="20" viewBox="0 0 28 28" fill="none" stroke="var(--on-accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M2 14h8l3-8 4 16 3-8h6" />
              </svg>
            </span>
            <div className="flex flex-col">
              <span className="text-[15px] font-bold">{APP_NAME}</span>
              <span className="text-xs text-dim">{all.auth.tagline}</span>
            </div>
          </div>
          <div role="group" aria-label={all.settings.language} className="flex gap-1 text-xs">
            {LANGUAGES.map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={l === language}
                onClick={() => setLanguage(l)}
                className={`rounded-lg px-2 py-1 font-semibold uppercase ${l === language ? 'bg-chip text-ink' : 'text-dim hover:text-ink'}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <section className="card flex flex-col gap-5 p-6">
          <h1 className="m-0 text-xl font-bold tracking-tight">{title}</h1>
          {children}
        </section>
        {footer && <div className="text-center text-[13px] text-dim">{footer}</div>}
      </div>
    </main>
  );
}

function Errors({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <ul role="alert" className="m-0 list-none rounded-(--radius-control) bg-sell-soft p-3 text-[13px] text-sell">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

const linkClass = 'font-semibold text-ink underline-offset-2 hover:underline';

export function LoginPage() {
  const t = useT().auth;
  const errorText = useErrorText();
  const navigate = useNavigate();
  const resetSession = useResetSession();
  const { data: config } = useAuthConfig();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors([]);
    try {
      await authApi.signIn(email.trim(), password);
      await resetSession();
      await navigate({ to: safeNext(query().get('next')) });
    } catch (err) {
      setErrors([errorText(err)]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={t.signInTitle}
      footer={
        config?.registration !== 'closed' && (
          <>
            {t.noAccount}{' '}
            <Link to="/rejestracja" className={linkClass}>
              {t.signUp}
            </Link>
          </>
        )
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t.email}>
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="font-sans" />
        </Field>
        <Field
          label={t.password}
          hint={
            <Link to="/reset-hasla" className={linkClass}>
              {t.forgot}
            </Link>
          }
        >
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Errors lines={errors} />
        <Button type="submit" variant="primary" size="lg" disabled={busy}>
          {busy ? t.signingIn : t.signIn}
        </Button>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const t = useT().auth;
  const language = useLanguage();
  const errorText = useErrorText();
  const navigate = useNavigate();
  const resetSession = useResetSession();
  const { data: config } = useAuthConfig();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState(() => query().get('kod') ?? '');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors([]);
    try {
      await authApi.signUp({
        name: name.trim(),
        email: email.trim(),
        password,
        inviteCode: inviteCode.trim() || undefined,
        language,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      await resetSession();
      await navigate({ to: '/' });
    } catch (err) {
      setErrors([errorText(err)]);
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <>
      {t.haveAccount}{' '}
      <Link to="/logowanie" className={linkClass}>
        {t.signIn}
      </Link>
    </>
  );

  if (config?.registration === 'closed') {
    return (
      <AuthLayout title={t.signUpTitle} footer={footer}>
        <p className="m-0 text-sm text-dim">{t.registrationClosed}</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t.signUpTitle} footer={footer}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {config?.registration !== 'open' && (
          <Field label={t.inviteCode} hint={t.inviteHint}>
            <Input value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase())} required autoComplete="off" />
          </Field>
        )}
        <Field label={t.name}>
          <Input autoComplete="nickname" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} className="font-sans" />
        </Field>
        <Field label={t.email}>
          <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="font-sans" />
        </Field>
        <Field label={t.password} hint={t.passwordHint}>
          <Input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Errors lines={errors} />
        <Button type="submit" variant="primary" size="lg" disabled={busy}>
          {busy ? t.signingUp : t.signUp}
        </Button>
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const t = useT().auth;
  const errorText = useErrorText();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors([]);
    try {
      await authApi.requestReset(email.trim());
      setSent(true);
    } catch (err) {
      setErrors([errorText(err)]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={t.forgotTitle}
      footer={
        <Link to="/logowanie" className={linkClass}>
          {t.backToSignIn}
        </Link>
      }
    >
      {sent ? (
        <p role="status" className="m-0 rounded-(--radius-control) bg-buy-soft p-3 text-sm text-buy">
          {t.linkSent}
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <p className="m-0 text-sm text-dim">{t.forgotIntro}</p>
          <Field label={t.email}>
            <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="font-sans" />
          </Field>
          <Errors lines={errors} />
          <Button type="submit" variant="primary" size="lg" disabled={busy}>
            {t.sendLink}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const t = useT().auth;
  const errorText = useErrorText();
  const [token] = useState(() => query().get('token') ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors([]);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setErrors([errorText(err)]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={t.resetTitle}
      footer={
        <Link to="/logowanie" className={linkClass}>
          {t.backToSignIn}
        </Link>
      }
    >
      {!token ? (
        <p className="m-0 text-sm text-sell">{t.missingToken}</p>
      ) : done ? (
        <p role="status" className="m-0 rounded-(--radius-control) bg-buy-soft p-3 text-sm text-buy">
          {t.passwordChanged}
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label={t.newPassword} hint={t.passwordHint}>
            <Input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <Errors lines={errors} />
          <Button type="submit" variant="primary" size="lg" disabled={busy}>
            {t.savePassword}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
