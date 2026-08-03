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
//
// Residoro Design Language (tb-design-system-modals-001): follows
// ListingDetailModal's header/body/footer pattern -- title + ink-600
// description line, footer with cancel left / gold confirm right that names
// the object. No new/updated/conflicts breakdown or skipped-rows warning
// card here (design doc section 10 illustrates those) since this component's
// actual props only carry a flat row count -- adding that structure would
// require new props/state, out of scope for a markup-only pass.
export function ConfirmImportModal({ totalRows, entityLabel, busy, onConfirm, onCancel }: Props) {
  const noun =
    entityLabel === 'contact'
      ? `contact${totalRows === 1 ? '' : 's'}`
      : `propert${totalRows === 1 ? 'y' : 'ies'}`;
  return (
    <Card role="dialog" aria-label="Confirm import">
      <CardContent className="space-y-4 pt-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">
            Confirm import · {totalRows} row{totalRows === 1 ? '' : 's'}
          </h2>
          <p className="text-xs text-muted-foreground">
            This will import {totalRows} {noun} into Residoro. Nothing is imported until you confirm, and it cannot
            be undone automatically after 24 hours.
          </p>
        </div>
        <div className="flex items-center gap-2 border-t pt-4">
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            {busy ? 'Importing…' : `Import ${totalRows} ${noun}`}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
