import type { PreviewProperty } from '../lib/migrationsApi';

type Props = {
  properties: PreviewProperty[];
  totalRows: number;
  totalValidationErrors: number;
};

export function PreviewTable({ properties, totalRows, totalValidationErrors }: Props) {
  const columns = properties.length > 0
    ? Object.keys(properties[0]).filter((key) => key !== 'row_number' && key !== 'validation_errors')
    : [];

  return (
    <div>
      <p className="text-sm text-muted-foreground">
        Showing {properties.length} of {totalRows} rows.{' '}
        {totalValidationErrors > 0
          ? `${totalValidationErrors} row(s) in this preview have validation errors.`
          : 'No validation errors in this preview.'}
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-4 font-medium">Row</th>
              {columns.map((col) => (
                <th key={col} className="py-2 pr-4 font-medium">
                  {col}
                </th>
              ))}
              <th className="py-2 pr-4 font-medium">Errors</th>
            </tr>
          </thead>
          <tbody>
            {properties.map((property) => (
              <tr key={property.row_number} className="border-b">
                <td className="py-2 pr-4">{property.row_number}</td>
                {columns.map((col) => (
                  <td key={col} className="py-2 pr-4">
                    {String(property[col] ?? '')}
                  </td>
                ))}
                <td className="py-2 pr-4 text-destructive">{property.validation_errors.join('; ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        No data has been imported to Residoro yet — this is a preview only.
      </p>
    </div>
  );
}
