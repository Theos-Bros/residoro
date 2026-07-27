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
        <CardContent className="space-y-3 pt-6">
          <h2 className="text-lg font-semibold tracking-tight">Remove units?</h2>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Developer</dt>
              <dd className="font-medium">{developerName}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Project</dt>
              <dd className="font-medium">{projectName}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Unit type</dt>
              <dd className="font-medium">{unitTypeName}</dd>
            </div>
          </dl>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              Units to remove ({unitNumbers.length}):
            </p>
            <p className="text-sm font-medium">{unitNumbers.join(', ')}</p>
          </div>
          <p className="text-sm text-destructive">This cannot be undone.</p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="destructive" onClick={onConfirm} disabled={busy}>
              {busy ? 'Removing…' : 'Confirm removal'}
            </Button>
            <Button variant="outline" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
