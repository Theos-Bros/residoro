import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type Props = {
  memberName: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

// tb-client-lifecycle-member-invite-001: same centered-overlay Card pattern
// as ConfirmRemoveUnitsModal (not a native window.confirm() or a new Dialog
// primitive) -- removal here is a hard delete of the member's account, a
// consequential-enough action to warrant an explicit confirm step.
export function ConfirmRemoveMemberModal({ memberName, busy, error, onConfirm, onCancel }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card role="dialog" aria-label="Confirm member removal" className="w-full max-w-md">
        <CardContent className="space-y-3 pt-6">
          <h2 className="text-lg font-semibold tracking-tight">Remove {memberName}?</h2>
          <p className="text-sm text-muted-foreground">
            They will no longer be able to sign in to this workspace.
          </p>
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
