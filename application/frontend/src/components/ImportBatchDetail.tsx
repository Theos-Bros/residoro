import { useState } from 'react';
import { fetchImportBatch, rollbackImportBatch, type BatchDetail } from '../lib/migrationsApi';
import { FailedRowsTable } from './FailedRowsTable';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';

type Props = {
  batch: BatchDetail;
  accessToken: string;
  tenantId?: string;
  onBatchUpdated: (batch: BatchDetail) => void;
};

// tb-migration-rollback-001: rollback gets the same inline-panel confirm
// pattern as ConfirmImportModal (not a native window.confirm()) -- it's
// destructive enough to deserve a confirm step, but stays inline in the step
// flow rather than an overlay, for the same reason that component gave.
export function ImportBatchDetail({ batch, accessToken, tenantId, onBatchUpdated }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRollBack = batch.status !== 'rolled_back' && new Date(batch.rollback_deadline).getTime() > Date.now();

  async function handleRollback() {
    setError(null);
    setRollingBack(true);
    try {
      await rollbackImportBatch(accessToken, batch.batch_id, tenantId);
      const refreshed = await fetchImportBatch(accessToken, batch.batch_id, tenantId);
      onBatchUpdated(refreshed);
      setConfirming(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRollingBack(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">Import complete</h2>
          <p className="text-sm">
            {batch.successful_imports} succeeded, {batch.failed_rows} failed
            {batch.skipped_rows > 0 ? `, ${batch.skipped_rows} skipped (already existed)` : ''}
            {batch.updated_rows > 0 ? `, ${batch.updated_rows} updated (overwritten)` : ''} (of{' '}
            {batch.total_rows} total rows in {batch.filename}).
          </p>
        </div>

        {batch.status === 'rolled_back' ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">
              Rolled back{batch.rolled_back_at ? ` on ${new Date(batch.rolled_back_at).toLocaleString()}` : ''}.
            </p>
            {batch.could_not_revert.length > 0 && (
              <p className="text-sm text-destructive">
                {batch.could_not_revert.length} overwritten row{batch.could_not_revert.length === 1 ? '' : 's'}{' '}
                imported before rollback was available could not be restored to their original values and
                were left as-is.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Rollback window ends: {new Date(batch.rollback_deadline).toLocaleString()}
          </p>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {canRollBack && !confirming && (
          <Button variant="outline" onClick={() => setConfirming(true)}>
            Rollback this import
          </Button>
        )}

        {canRollBack && confirming && (
          <div className="space-y-2 rounded-md border border-destructive/30 p-3">
            <p className="text-sm">
              This deletes every property/contact this import created and restores every one it
              overwrote to its previous values. This cannot be undone. Continue?
            </p>
            <div className="flex gap-2">
              <Button variant="destructive" onClick={handleRollback} disabled={rollingBack}>
                {rollingBack ? 'Rolling back…' : 'Roll back import'}
              </Button>
              <Button variant="outline" onClick={() => setConfirming(false)} disabled={rollingBack}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        <FailedRowsTable rows={batch.failed_row_details} />
      </CardContent>
    </Card>
  );
}
