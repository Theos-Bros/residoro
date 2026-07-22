import type { FailedRowDetail } from '../lib/migrationsApi';

type Props = {
  rows: FailedRowDetail[];
};

export function FailedRowsTable({ rows }: Props) {
  if (rows.length === 0) return null;

  const columns = Object.keys(rows[0].original_row);

  return (
    <div>
      <h3>Failed rows</h3>
      <table border={1} cellPadding={6}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col}>{col}</th>
            ))}
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((col) => (
                <td key={col}>{row.original_row[col]}</td>
              ))}
              <td>{row.error_message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
