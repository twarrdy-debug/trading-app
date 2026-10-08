import { MonitorPanel } from '../journal/MonitorPanel.tsx';
import { useSelectedAccount } from './AccountSwitcher.tsx';
import { AccountPanel } from './AccountViews.tsx';

/**
 * The selected account (or every account in the "all accounts" view) next to the trading monitor:
 * the same panels as the journal, for the dashboard and the trades page.
 */
export function AccountsAndMonitor({ currency, accounts: showAccounts = true, monitor: showMonitor = true }: { currency: string; accounts?: boolean; monitor?: boolean }) {
  const { accounts, filter, selected } = useSelectedAccount();
  const shown = !showAccounts ? [] : selected ? [selected] : filter === '' ? accounts : [];
  if (shown.length === 0 && !showMonitor) return null;
  const both = shown.length > 0 && showMonitor;

  return (
    // One account: account and monitor side by side in halves; several: the accounts take two thirds.
    <div className={`grid gap-4 ${both ? (shown.length === 1 ? 'lg:grid-cols-2' : 'lg:grid-cols-3') : ''}`}>
      {shown.length > 0 && (
        // Cards stretch to the row (the monitor's height), so the row has no holes between tiles.
        <div className={`grid gap-4 ${both && shown.length > 1 ? 'lg:col-span-2' : ''} ${shown.length > 1 ? 'sm:grid-cols-2' : ''} ${shown.length > 2 && !both ? 'xl:grid-cols-3' : ''}`}>
          {shown.map((a) => (
            <AccountPanel key={a.id} account={a} currency={currency} />
          ))}
        </div>
      )}
      {showMonitor && <MonitorPanel />}
    </div>
  );
}
