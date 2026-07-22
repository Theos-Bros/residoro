import { Button } from './ui/button';

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
    <div role="dialog" aria-label="Confirm import" className="mt-4 rounded-md border p-4">
      <p className="text-sm">
        This will import {totalRows} propert{totalRows === 1 ? 'y' : 'ies'} into Residoro. This
        cannot be undone automatically after 24 hours. Continue?
      </p>
      <div className="mt-3 flex gap-2">
        <Button onClick={onConfirm} disabled={busy}>
          {busy ? 'Importing…' : 'Confirm import'}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
