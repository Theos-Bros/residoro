import type { BatchDetail } from '../lib/migrationsApi';
import { FailedRowsTable } from './FailedRowsTable';

type Props = {
  batch: BatchDetail;
};

export function ImportBatchDetail({ batch }: Props) {
  return (
    <div>
      <h2 className="text-xl font-semibold">Import complete</h2>
      <p className="mt-2 text-sm">
        {batch.successful_imports} succeeded, {batch.failed_rows} failed (of {batch.total_rows}{' '}
        total rows in {batch.filename}).
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Rollback window ends: {new Date(batch.rollback_deadline).toLocaleString()}
      </p>
      <FailedRowsTable rows={batch.failed_row_details} />
    </div>
  );
}
