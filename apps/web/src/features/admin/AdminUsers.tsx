import type { AdminUser, PublicUser } from '@trading/api/types';
import { ROLE_KEYS, type RoleKey } from '@trading/shared';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError } from '../../api/client.ts';
import { useAdminUpdateUser, useAdminUserAction, useAdminUsers, type AdminUserAction } from '../../api/hooks.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Input } from '../../components/ui/Field.tsx';
import { Select } from '../../components/ui/Select.tsx';
import { useT } from '../../i18n/index.tsx';
import { formatDate, formatRelative } from '../../lib/format.ts';

/** Every account with its role, activity, usage and status; actions ask for confirmation first. */
export function AdminUsers({ me }: { me: PublicUser }) {
  const all = useT();
  const t = all.admin.users;
  const roleName = (role: string) => all.settings.roles[role] ?? role;
  const { data: users = [], isLoading } = useAdminUsers();
  const update = useAdminUpdateUser();
  const action = useAdminUserAction();
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  const q = query.trim().toLowerCase();
  const shown = q ? users.filter((u) => u.displayName.toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q)) : users;
  const fail = (err: unknown) => setMessage({ text: err instanceof ApiError ? err.lines.join(' ') : String(err), tone: 'error' });

  const changeRole = (u: AdminUser, role: RoleKey) => {
    if (role === u.role || !window.confirm(t.confirmRole(u.displayName, roleName(role)))) return;
    update.mutate({ id: u.id, patch: { role } }, { onSuccess: () => setMessage({ text: t.done.role(u.displayName, roleName(role)), tone: 'ok' }), onError: fail });
  };
  const toggleBlock = (u: AdminUser) => {
    const block = !u.disabledAt;
    if (block && !window.confirm(t.confirmBlock(u.displayName))) return;
    update.mutate(
      { id: u.id, patch: { disabled: block } },
      { onSuccess: () => setMessage({ text: block ? t.done.block(u.displayName) : t.done.unblock(u.displayName), tone: 'ok' }), onError: fail },
    );
  };
  const run = (u: AdminUser, kind: AdminUserAction) => {
    if (kind === 'delete' && !window.confirm(t.confirmDelete(u.displayName, u.trades))) return;
    action.mutate(
      { id: u.id, action: kind },
      {
        onSuccess: (res) =>
          setMessage({
            text:
              kind === 'revoke'
                ? t.done.revoke(res.revoked ?? 0)
                : kind === 'reset'
                  ? res.emailConfigured
                    ? t.done.reset(u.email ?? '')
                    : t.done.resetLog
                  : t.done.delete(u.displayName),
            tone: 'ok',
          }),
        onError: fail,
      },
    );
  };
  const busy = update.isPending || action.isPending;

  return (
    <section className="card flex flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.search} aria-label={t.search} className="max-w-sm font-sans" />
        <span className="font-mono text-xs text-dim">{t.count(shown.length)}</span>
      </div>
      {message && (
        <p role="status" className={`m-0 border-b border-line px-5 py-3 text-[13px] ${message.tone === 'ok' ? 'text-buy' : 'text-sell'}`}>
          {message.text}
        </p>
      )}
      {isLoading ? (
        <p className="m-0 p-5 text-sm text-dim">{all.common.loading}</p>
      ) : shown.length === 0 ? (
        <p className="m-0 p-5 text-sm text-dim">{t.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] border-collapse text-sm">
            <thead className="bg-raised">
              <tr>
                {Object.values(t.columns).map((label) => (
                  <th key={label} scope="col" className="px-4 py-2.5 text-left text-xs font-semibold whitespace-nowrap text-dim">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => {
                const self = u.id === me.id;
                const status = u.disabledAt ? 'disabled' : !u.onboardedAt ? 'onboarding' : !u.canSignIn ? 'noPassword' : 'active';
                const statusTone =
                  status === 'disabled' ? 'bg-sell-soft text-sell' : status === 'active' ? 'bg-buy-soft text-buy' : 'bg-warn-bg text-warn';
                return (
                  <tr key={u.id} className={`border-b border-line align-top last:border-b-0 ${u.disabledAt ? 'opacity-70' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-semibold">
                          {u.displayName}
                          {self && <span className="ml-2 rounded-md bg-chip px-1.5 py-0.5 text-[10px] font-bold text-dim">{t.you}</span>}
                        </span>
                        <span className="text-xs text-dim">{u.email ?? '—'}</span>
                      </div>
                    </td>
                    <td className="w-40 px-4 py-3">
                      <Select
                        aria-label={`${t.columns.role}: ${u.displayName}`}
                        value={u.role}
                        disabled={self || busy}
                        onChange={(role) => changeRole(u, role as RoleKey)}
                        options={ROLE_KEYS.map((r) => ({ value: r, label: roleName(r) }))}
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="font-mono">{formatDate(u.createdAt.slice(0, 10))}</span>
                        {u.signupCode && <span className="text-xs text-dim">{t.viaCode(u.signupCode)}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span>{u.lastSeenAt ? formatRelative(u.lastSeenAt) : t.never}</span>
                        {u.activeSessions > 0 && <span className="text-xs text-dim">{t.sessions(u.activeSessions)}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-dim">{t.usage(u.trades, u.accounts, u.strategies)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap ${statusTone}`}>{t.status[status]}</span>
                    </td>
                    <td className="px-4 py-3">
                      {!self && (
                        <ActionsMenu
                          label={`${t.columns.actions}: ${u.displayName}`}
                          disabled={busy}
                          items={[
                            { key: 'revoke', label: t.actions.revoke, disabled: u.activeSessions === 0, onSelect: () => run(u, 'revoke') },
                            { key: 'reset', label: t.actions.reset, disabled: !u.email, onSelect: () => run(u, 'reset') },
                            { key: 'block', label: u.disabledAt ? t.actions.unblock : t.actions.block, onSelect: () => toggleBlock(u) },
                            { key: 'delete', label: t.actions.delete, danger: true, onSelect: () => run(u, 'delete') },
                          ]}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

interface MenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

/** "Actions ▾" button with a small menu; Escape or a click outside closes it. */
function ActionsMenu({ label, items, disabled }: { label: string; items: MenuItem[]; disabled?: boolean }) {
  const t = useT().admin.users;
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = position != null;
  // Rendered over the page (the table scrolls and would clip it), right-aligned under the button.
  const toggle = () => {
    if (open) return setPosition(null);
    const box = buttonRef.current?.getBoundingClientRect();
    if (box) setPosition({ top: box.bottom + 4, right: window.innerWidth - box.right });
  };
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') setPosition(null);
      } else if (!menuRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setPosition(null);
    };
    // Follows the button when the page or the table scrolls.
    const follow = () => {
      const box = buttonRef.current?.getBoundingClientRect();
      if (box) setPosition({ top: box.bottom + 4, right: window.innerWidth - box.right });
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
  }, [open]);
  return (
    <div ref={buttonRef} className="inline-block">
      <Button size="sm" aria-label={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={toggle} className="whitespace-nowrap">
        {t.columns.actions} ▾
      </Button>
      {position &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: 'fixed', top: position.top, right: position.right }}
            className="z-50 flex min-w-52 flex-col rounded-(--radius-control) border border-line bg-panel p-1 shadow-(--shadow-pop)"
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setPosition(null);
                  item.onSelect();
                }}
                className={`rounded-[9px] px-3 py-2 text-left text-sm transition hover:bg-chip disabled:opacity-40 disabled:hover:bg-transparent ${item.danger ? 'text-sell' : 'text-ink'}`}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
