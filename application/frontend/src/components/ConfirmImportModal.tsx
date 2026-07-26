import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';

type Props = {
  totalRows: number;
  entityLabel: 'property' | 'contact';
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

// A plain inline panel, not a native window.confirm() -- keeps the flow
// testable via normal DOM interaction/automation instead of a blocking
// browser dialog. Restyled as a Card, not a shadcn Dialog/overlay: it renders
// inline in the step flow today, and swapping to an overlay would change that
// interaction model, out of scope for a styling-only pass (tb-design-system-
// admin-001's Decision, see Context).
export function ConfirmImportModal({ totalRows, entityLabel, busy, onConfirm, onCancel }: Props) {
  const noun =
    entityLabel === 'contact'
      ? `contact${totalRows === 1 ? '' : 's'}`
      : `propert${totalRows === 1 ? 'y' : 'ies'}`;
  return (
    <Card role="dialog" aria-label="Confirm import">
      <CardContent className="pt-6">
        <p className="text-sm">
          This will import {totalRows} {noun} into Residoro. This
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
      </CardContent>
    </Card>
  );
}
