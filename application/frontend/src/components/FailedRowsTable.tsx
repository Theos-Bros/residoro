import type { FailedRowDetail } from '../lib/migrationsApi';

type Props = {
  rows: FailedRowDetail[];
};

export function FailedRowsTable({ rows }: Props) {
  if (rows.length === 0) return null;

  const columns = Object.keys(rows[0].original_row);

  return (
    <div className="mt-4">
      <h3 className="text-lg font-semibold">Failed rows</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              {columns.map((col) => (
                <th key={col} className="py-2 pr-4 font-medium">
                  {col}
                </th>
              ))}
              <th className="py-2 pr-4 font-medium">Error</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-b">
                {columns.map((col) => (
                  <td key={col} className="py-2 pr-4">
                    {row.original_row[col]}
                  </td>
                ))}
                <td className="py-2 pr-4 text-destructive">{row.error_message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
