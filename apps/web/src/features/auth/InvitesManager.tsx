import { useState } from 'react';
import { useCreateInvite, useDeleteInvite, useInvites } from '../../api/auth.ts';
import { ApiError } from '../../api/client.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Field, Input } from '../../components/ui/Field.tsx';
import { Select } from '../../components/ui/Select.tsx';
import { useT } from '../../i18n/index.tsx';
import { formatDateTime } from '../../lib/format.ts';

type InviteRole = 'user' | 'vip' | 'educator';
const VALIDITY = { d14: 14, d30: 30, d90: 90, d365: 365, never: null } as const;
type Validity = keyof typeof VALIDITY;

/** Admin: create invitation codes and copy their registration links (settings page). */
export function InvitesManager({ timezone }: { timezone: string }) {
  const t = useT().invites;
  const { data: invites = [] } = useInvites(true);
  const create = useCreateInvite();
  const remove = useDeleteInvite();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('user');
  const [code, setCode] = useState('');
  const [multiUse, setMultiUse] = useState(false);
  const [validity, setValidity] = useState<Validity>('d14');
  const [copied, setCopied] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  /** What happened to the last invite: e-mailed to an address, or its link copied. */
  const [notice, setNotice] = useState<string | null>(null);

  const link = (code: string) => `${window.location.origin}/rejestracja?kod=${code}`;
  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(link(code));
      setCopied(code);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  };

  const submit = () => {
    setErrors([]);
    setNotice(null);
    create.mutate(
      { email: email.trim() || undefined, role, code: code.trim() || undefined, multiUse, expiresInDays: VALIDITY[validity] },
      {
        onSuccess: (invite) => {
          setEmail('');
          setCode('');
          setMultiUse(false);
          void copy(invite.code);
          setNotice(invite.email ? (invite.emailed ? t.emailed(invite.email) : t.emailFailed(invite.email)) : t.linkCopied);
        },
        onError: (err) => setErrors(err instanceof ApiError ? err.lines : [err.message]),
      },
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <Field label={t.email} help={t.emailHint}>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="font-sans" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t.code} help={t.codeHint}>
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={32} placeholder="DIXIGROUP26" className="font-mono" />
        </Field>
        <Field label={t.validity}>
          <Select value={validity} onChange={setValidity} options={(Object.keys(VALIDITY) as Validity[]).map((v) => ({ value: v, label: t.validityOptions[v] }))} />
        </Field>
      </div>
      <label className="flex cursor-pointer items-start gap-2.5 text-sm">
        <input type="checkbox" checked={multiUse} onChange={(e) => setMultiUse(e.target.checked)} className="mt-0.5 size-4 accent-(--accent)" />
        <span className="flex flex-col">
          <span className="font-semibold">{t.multiUse}</span>
          <span className="text-xs text-dim">{t.multiUseHint}</span>
        </span>
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t.role} className="w-44">
          <Select
            value={role}
            onChange={setRole}
            options={(['user', 'vip', 'educator'] as const).map((r) => ({ value: r, label: t.roles[r]! }))}
          />
        </Field>
        <Button size="md" variant="primary" onClick={submit} disabled={create.isPending} className="whitespace-nowrap">
          {t.create}
        </Button>
      </div>
      {errors.length > 0 && <p className="m-0 text-[13px] text-sell">{errors.join(' ')}</p>}
      {notice && <p className="m-0 text-[13px] text-dim" role="status">{notice}</p>}
      {invites.length === 0 ? (
        <span className="text-[13px] text-dim">{t.empty}</span>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {invites.map((invite) => {
            const expired = invite.expiresAt != null && new Date(invite.expiresAt).getTime() < Date.now();
            const used = !invite.multiUse && invite.usedBy != null;
            const status = used ? t.used : expired ? t.expired : invite.expiresAt ? t.expires(formatDateTime(invite.expiresAt, timezone)) : t.noExpiry;
            const usable = !used && !expired;
            return (
              <li key={invite.id} className="flex items-center gap-3 rounded-(--radius-control) bg-raised px-3.5 py-2.5">
                <div className="flex min-w-0 grow flex-col">
                  <span className={`font-mono text-sm font-semibold ${usable ? '' : 'text-dim line-through'}`}>{invite.code}</span>
                  <span className="truncate text-[11px] text-dim">
                    {[t.roles[invite.role], invite.multiUse && `${t.group}, ${t.uses(invite.useCount)}`, invite.email, status].filter(Boolean).join(' · ')}
                  </span>
                </div>
                {usable && (
                  <Button size="sm" variant="ghost" onClick={() => void copy(invite.code)} className="whitespace-nowrap">
                    {copied === invite.code ? t.copied : t.copy}
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => remove.mutate(invite.id)} disabled={remove.isPending} className="text-sell!">
                  {t.delete}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
