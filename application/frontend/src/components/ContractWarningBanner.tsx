import type { WorkspaceStatus } from '@/lib/workspaceApi';

type Props = {
  status: WorkspaceStatus | null;
};

const TIER_LABEL: Record<'30d' | '7d' | '1d', string> = {
  '30d': '30 days',
  '7d': '7 days',
  '1d': '1 day',
};

// tb-client-lifecycle-contract-expiry-001: styled with plain inline styles
// rather than Tailwind, matching tb-migration-csv-hardening-001's explicit
// decision to keep styling scoped to the migration flow's own components,
// not the general app shell this banner lives in.
export function ContractWarningBanner({ status }: Props) {
  if (!status) return null;

  if (status.access_state === 'blocked') {
    return (
      <div style={{ background: '#fdecea', color: '#611a15', padding: '12px 16px' }}>
        Access blocked: your contract expired more than 7 days ago. Contact your Residoro
        representative to renew.
      </div>
    );
  }

  if (status.access_state === 'read_only') {
    return (
      <div style={{ background: '#fff4e5', color: '#663c00', padding: '12px 16px' }}>
        Read-only grace period: your contract has expired. You can still view and export your
        data, but creating/editing/deleting is disabled. Contact your Residoro representative to
        renew.
      </div>
    );
  }

  if (status.active_warning) {
    return (
      <div style={{ background: '#fffbe5', color: '#665200', padding: '12px 16px' }}>
        Your contract expires in {TIER_LABEL[status.active_warning]} (on {status.contract_end_date}
        ). Contact your Residoro representative to renew.
      </div>
    );
  }

  return null;
}
