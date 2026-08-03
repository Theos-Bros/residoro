import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type Props = {
  developerName: string;
  projectName: string;
  unitTypeName: string;
  unitNumbers: string[];
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

// tb-properties-project-rollup-001 follow-up: a true centered overlay (not
// an inline Card like ConfirmImportModal) since removing generated units is
// a distinct, more consequential confirm step than that flow's own -- still
// a plain styled Card, not a native window.confirm() or a new shadcn Dialog
// primitive, so it stays testable via normal DOM interaction/automation.
//
// Residoro Design Language (tb-design-system-modals-001): destructive
// two-button footer (cancel left, red confirm right, naming the object --
// "Remove N units", not "Confirm removal"). Design doc section 10 shows a
// per-unit consequence line (e.g. "Live listing -- will be withdrawn"); this
// component's actual props only carry developer/project/unit-type names and
// a flat unitNumbers list, no per-unit consequence data, so that per-row text
// isn't added here -- would require new props/state, out of scope for a
// markup-only pass.
export function ConfirmRemoveUnitsModal({
  developerName,
  projectName,
  unitTypeName,
  unitNumbers,
  busy,
  error,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card role="dialog" aria-label="Confirm unit removal" className="w-full max-w-md">
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight">
              Remove {unitNumbers.length} unit{unitNumbers.length === 1 ? '' : 's'}
            </h2>
            <p className="text-xs text-muted-foreground">This can't be undone.</p>
          </div>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-tertiary-foreground">Developer</dt>
              <dd className="font-medium">{developerName}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-tertiary-foreground">Project</dt>
              <dd className="font-medium">{projectName}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-tertiary-foreground">Unit type</dt>
              <dd className="font-medium">{unitTypeName}</dd>
            </div>
          </dl>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Units to remove ({unitNumbers.length}):</p>
            <p className="font-mono text-sm">{unitNumbers.join(', ')}</p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex items-center gap-2 border-t pt-4">
            <Button variant="outline" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onConfirm} disabled={busy}>
              {busy ? 'Removing…' : `Remove ${unitNumbers.length} unit${unitNumbers.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
