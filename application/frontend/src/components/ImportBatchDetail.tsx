import type { BatchDetail } from '../lib/migrationsApi';
import { FailedRowsTable } from './FailedRowsTable';
import { Card, CardContent } from './ui/card';

type Props = {
  batch: BatchDetail;
};

export function ImportBatchDetail({ batch }: Props) {
  return (
    <Card>
      <CardContent className="space-y-1 pt-6">
        <h2 className="text-xl font-semibold tracking-tight">Import complete</h2>
        <p className="text-sm">
          {batch.successful_imports} succeeded, {batch.failed_rows} failed (of {batch.total_rows}{' '}
          total rows in {batch.filename}).
        </p>
        <p className="text-sm text-muted-foreground">
          Rollback window ends: {new Date(batch.rollback_deadline).toLocaleString()}
        </p>
        <FailedRowsTable rows={batch.failed_row_details} />
      </CardContent>
    </Card>
  );
}
