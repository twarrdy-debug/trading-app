import type { PublicUser } from '@trading/api/types';
import { API_KEY_MAX_DAYS } from '@trading/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ApiError } from '../../api/client.ts';
import { useAccounts, useApiKeys, useCreateApiKey, useRevokeApiKey } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Field, Input, Segmented, Textarea } from '../../components/ui/Field.tsx';
import { Select } from '../../components/ui/Select.tsx';
import { useT } from '../../i18n/index.tsx';
import { currentLocale } from '../../lib/format.ts';

const VALIDITY = ['30', '60', String(API_KEY_MAX_DAYS)] as const;

/** Keys for a trading bot: made with 2FA, shown once, one account each, at most 90 days. */
export function ApiKeysSection({ user }: { user: PublicUser }) {
  const t = useT().apiKeys;
  const allowed = user.plan.features.includes('apiKeys');
  const { data: keys = [] } = useApiKeys(allowed);
  if (!allowed) return <Notice text={t.notEnabled} />;
  return (
    <div className="flex flex-col gap-4">
      {user.twoFactorEnabled ? (
        <NewKey timeZone={user.settings.timezone} />
      ) : (
        <Notice
          text={t.needs2fa}
          action={
            <Link to="/ustawienia/$section" params={{ section: 'profil' }} className="text-sm font-bold text-accent-ink no-underline hover:underline">
              {t.turnOn2fa} →
            </Link>
          }
        />
      )}
      <KeyList keys={keys} timeZone={user.settings.timezone} />
      <HowTo />
    </div>
  );
}

function Notice({ text, action }: { text: string; action?: React.ReactNode }) {
  return (
    <section className="card flex flex-wrap items-center justify-between gap-3 p-5">
      <span className="text-sm">{text}</span>
      {action}
    </section>
  );
}

function NewKey({ timeZone }: { timeZone: string }) {
  const all = useT();
  const t = all.apiKeys;
  const { data: accounts = [] } = useAccounts();
  const create = useCreateApiKey();
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [days, setDays] = useState<(typeof VALIDITY)[number]>(String(API_KEY_MAX_DAYS) as (typeof VALIDITY)[number]);
  const [ips, setIps] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [made, setMade] = useState<{ key: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const account = accountId || accounts[0]?.id || '';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors([]);
    create.mutate(
      {
        name: name.trim(),
        accountId: account,
        expiresInDays: Number(days),
        ipAllowlist: ips.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
        password,
        code: code.trim(),
      },
      {
        onSuccess: (res) => {
          setMade({ key: res.key, expiresAt: res.expiresAt });
          setPassword('');
          setCode('');
          setName('');
          setIps('');
        },
        onError: (err) => setErrors(err instanceof ApiError ? err.lines : [String(err)]),
      },
    );
  };

  if (made) {
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(made.key);
        setCopied(true);
      } catch {
        setCopied(false);
      }
    };
    return (
      <section className="card flex flex-col gap-3 p-5" aria-live="polite">
        <h3 className="m-0 text-[15px] font-bold">{t.madeTitle}</h3>
        <p className="m-0 rounded-(--radius-control) bg-accent/10 px-3 py-2.5 text-[13px] ring-1 ring-accent/30 ring-inset">{t.madeWarning}</p>
        <code className="rounded-(--radius-control) bg-raised px-3 py-3 font-mono text-[13px] break-all select-all">{made.key}</code>
        <span className="text-xs text-dim">{t.validUntil(new Date(made.expiresAt).toLocaleString(currentLocale(), { timeZone, dateStyle: 'medium', timeStyle: 'short' }))}</span>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void copy()}>
            {copied ? t.copied : t.copy}
          </Button>
          <Button onClick={() => setMade(null)}>{t.done}</Button>
        </div>
      </section>
    );
  }

  return (
    <form onSubmit={submit} className="card flex flex-col gap-4 p-5" aria-label={t.newTitle}>
      <h3 className="m-0 text-[15px] font-bold">{t.newTitle}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={t.namePlaceholder} className="font-sans" required />
        </Field>
        <Field label={t.account} help={t.accountHelp}>
          <Select value={account} onChange={setAccountId} options={accounts.map((a) => ({ value: a.id, label: a.name }))} />
        </Field>
        <Field label={t.validity}>
          <div>
            <Segmented label={t.validity} value={days} onChange={setDays} options={VALIDITY.map((d) => ({ value: d, label: t.days(Number(d)) }))} />
          </div>
        </Field>
        <Field label={t.ips} help={t.ipsHelp}>
          <Textarea value={ips} onChange={(e) => setIps(e.target.value)} rows={2} placeholder="203.0.113.7" className="font-mono" />
        </Field>
        <Field label={t.password}>
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Field label={t.code} help={t.codeHelp}>
          <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
        </Field>
      </div>
      {errors.length > 0 && (
        <ul role="alert" className="m-0 list-none rounded-(--radius-control) bg-sell-soft p-3 text-[13px] text-sell">
          {errors.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <div>
        <Button type="submit" variant="primary" disabled={create.isPending || !account || !name.trim() || !password || code.length !== 6}>
          {t.create}
        </Button>
      </div>
    </form>
  );
}

function KeyList({ keys, timeZone }: { keys: ReturnType<typeof useApiKeys>['data'] & object; timeZone: string }) {
  const t = useT().apiKeys;
  const revoke = useRevokeApiKey();
  const [open, setOpen] = useState<string | null>(null);
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(currentLocale(), { timeZone, dateStyle: 'medium', timeStyle: 'short' }) : '—');
  return (
    <section className="card flex flex-col gap-2 p-5" aria-label={t.listTitle}>
      <h3 className="m-0 text-[15px] font-bold">{t.listTitle}</h3>
      {keys.length === 0 && <span className="text-[13px] text-dim">{t.none}</span>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {keys.map((k) => (
          <li key={k.id} className="flex flex-col gap-2 rounded-(--radius-control) bg-raised px-3.5 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-sm font-semibold">{k.name}</span>
              <span className="font-mono text-xs text-dim">{k.prefix}…</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${k.status === 'active' ? 'bg-buy-soft text-buy' : 'bg-chip text-dim'}`}>{t.status[k.status]}</span>
              <div className="grow" />
              <Button size="sm" variant="ghost" onClick={() => setOpen(open === k.id ? null : k.id)} aria-expanded={open === k.id}>
                {t.history}
              </Button>
              {k.status === 'active' && (
                <Button size="sm" variant="ghost" className="text-sell!" disabled={revoke.isPending} onClick={() => window.confirm(t.revokeConfirm(k.name)) && revoke.mutate(k.id)}>
                  {t.revoke}
                </Button>
              )}
            </div>
            <span className="text-xs text-dim">
              {t.line(k.accountName, when(k.expiresAt), k.lastUsedAt ? `${when(k.lastUsedAt)}${k.lastUsedIp ? ` · ${k.lastUsedIp}` : ''}` : t.never)}
              {k.ipAllowlist.length > 0 && ` · ${t.onlyFrom(k.ipAllowlist.join(', '))}`}
            </span>
            {open === k.id && (
              <ul className="m-0 flex list-none flex-col gap-1 border-t border-line p-0 pt-2 text-xs">
                {k.events.length === 0 && <li className="text-dim">{t.noEvents}</li>}
                {k.events.map((e, i) => (
                  <li key={i} className="flex flex-wrap gap-x-3">
                    <span className="font-mono text-dim">{when(e.at)}</span>
                    <span className={`font-bold ${e.outcome === 'refused' ? 'text-sell' : e.outcome === 'created' ? 'text-buy' : 'text-dim'}`}>{t.outcome[e.outcome] ?? e.outcome}</span>
                    <span className="font-mono text-dim">{e.ip}</span>
                    <span className="min-w-0 break-all">{e.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What the bot sends: one request per closed trade. */
function HowTo() {
  const t = useT().apiKeys;
  const example = `curl -X POST https://www.alphalogfx.com/api/bot/v1/trades \\
  -H "Authorization: Bearer alx_…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "externalId": "order-1042",
    "symbol": "NAS100",
    "direction": "buy",
    "size": 1,
    "entryPrice": 20000,
    "exitPrice": 20050,
    "stopLoss": 19980,
    "takeProfit": 20060,
    "openedAt": "2026-10-23T13:00:00Z",
    "closedAt": "2026-10-23T14:05:00Z"
  }'`;
  return (
    <section className="card flex flex-col gap-3 p-5" aria-label={t.howTitle}>
      <h3 className="m-0 text-[15px] font-bold">{t.howTitle}</h3>
      <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[13px] text-dim">
        {t.howPoints.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <pre className="m-0 overflow-x-auto rounded-(--radius-control) bg-raised p-3 font-mono text-[12px] leading-relaxed">{example}</pre>
    </section>
  );
}
