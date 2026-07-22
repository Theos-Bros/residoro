type Props = {
  totalRows: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

// A plain inline panel, not a native window.confirm() -- keeps the flow
// testable via normal DOM interaction/automation instead of a blocking
// browser dialog.
export function ConfirmImportModal({ totalRows, busy, onConfirm, onCancel }: Props) {
  return (
    <div role="dialog" aria-label="Confirm import">
      <p>
        This will import {totalRows} propert{totalRows === 1 ? 'y' : 'ies'} into Residoro. This
        cannot be undone automatically after 24 hours. Continue?
      </p>
      <button onClick={onConfirm} disabled={busy}>
        {busy ? 'Importing…' : 'Confirm import'}
      </button>
      <button onClick={onCancel} disabled={busy}>
        Cancel
      </button>
    </div>
  );
}
