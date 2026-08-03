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
//
// Residoro Design Language (tb-design-system-modals-001): destructive-confirm
// case of the modal-footer governance rule -- when the confirm action itself
// IS the destructive one (no separate third action), cancel sits left and the
// red confirm sits right, naming the object ("Remove {memberName}"), not
// "Confirm removal". Design doc section 10 illustrates a reassign-owner
// select and open-leads/listings/tasks counts card; this component's actual
// props (memberName, busy, error) carry none of that data, so it isn't added
// here -- would require new props/state, out of scope for a markup-only pass.
export function ConfirmRemoveMemberModal({ memberName, busy, error, onConfirm, onCancel }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card role="dialog" aria-label="Confirm member removal" className="w-full max-w-md">
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight">Remove {memberName} from this brokerage</h2>
            <p className="text-xs text-muted-foreground">
              They lose access immediately and will no longer be able to sign in to this workspace. This cannot be
              undone.
            </p>
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
              {busy ? 'Removing…' : `Remove ${memberName}`}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
