import type { AccountSummary } from '@trading/api/types';
import { useAccounts } from '../../api/hooks.ts';
import { Select } from '../../components/ui/Select.tsx';
import { useT } from '../../i18n/index.tsx';
import { useAccountFilter } from '../../lib/account-filter.ts';

/**
 * The account shown by the journal and statistics: `filter` is '' (all), 'none' or an id;
 * `selected` is that account. A remembered id of a deleted account falls back to all.
 */
export function useSelectedAccount(): { accounts: AccountSummary[]; filter: string; selected: AccountSummary | null } {
  const { data: accounts = [] } = useAccounts();
  const [stored] = useAccountFilter();
  const selected = accounts.find((a) => a.id === stored) ?? null;
  const filter = stored === 'none' || selected ? stored : '';
  return { accounts, filter, selected };
}

/** Drop-down with all accounts, each account and "no account"; hidden while there are no accounts. */
export function AccountSwitcher({ className = '' }: { className?: string }) {
  const t = useT().accounts;
  const { accounts, filter } = useSelectedAccount();
  const [, setFilter] = useAccountFilter();
  if (accounts.length === 0) return null;
  return (
    <div className={className}>
      <Select
        aria-label={t.switcher}
        value={filter}
        onChange={setFilter}
        options={[
          { value: '', label: t.all },
          ...accounts.map((a) => ({ value: a.id, label: a.name })),
          { value: 'none', label: t.none },
        ]}
      />
    </div>
  );
}
