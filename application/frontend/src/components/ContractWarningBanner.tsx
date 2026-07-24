import type { WorkspaceStatus } from '@/lib/workspaceApi';
import { cn } from '@/lib/utils';

type Props = {
  status: WorkspaceStatus | null;
};

const TIER_LABEL: Record<'30d' | '7d' | '1d', string> = {
  '30d': '30 days',
  '7d': '7 days',
  '1d': '1 day',
};

// tb-client-lifecycle-contract-expiry-001: originally styled with plain
// inline styles rather than Tailwind, matching tb-migration-csv-hardening-001's
// explicit decision to keep styling scoped to the migration flow's own
// components at the time. tb-design-system-brokerage-001 brings it onto the
// shared shadcn/ui + Tailwind token layer along with the rest of the shell.
export function ContractWarningBanner({ status }: Props) {
  if (!status) return null;

  const base = 'border-b px-4 py-3 text-sm sm:px-6';

  if (status.access_state === 'blocked') {
    return (
      <div className={cn(base, 'border-destructive/30 bg-destructive/10 text-destructive')}>
        Access blocked: your contract expired more than 7 days ago. Contact your Residoro
        representative to renew.
      </div>
    );
  }

  if (status.access_state === 'read_only') {
    return (
      <div className={cn(base, 'border-amber-300 bg-amber-50 text-amber-900')}>
        Read-only grace period: your contract has expired. You can still view and export your
        data, but creating/editing/deleting is disabled. Contact your Residoro representative to
        renew.
      </div>
    );
  }

  if (status.active_warning) {
    return (
      <div className={cn(base, 'border-yellow-200 bg-yellow-50 text-yellow-900')}>
        Your contract expires in {TIER_LABEL[status.active_warning]} (on {status.contract_end_date}
        ). Contact your Residoro representative to renew.
      </div>
    );
  }

  return null;
}
