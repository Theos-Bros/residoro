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
      <p>
        Showing {properties.length} of {totalRows} rows.{' '}
        {totalValidationErrors > 0
          ? `${totalValidationErrors} row(s) in this preview have validation errors.`
          : 'No validation errors in this preview.'}
      </p>
      <table border={1} cellPadding={6}>
        <thead>
          <tr>
            <th>Row</th>
            {columns.map((col) => (
              <th key={col}>{col}</th>
            ))}
            <th>Errors</th>
          </tr>
        </thead>
        <tbody>
          {properties.map((property) => (
            <tr key={property.row_number}>
              <td>{property.row_number}</td>
              {columns.map((col) => (
                <td key={col}>{String(property[col] ?? '')}</td>
              ))}
              <td>{property.validation_errors.join('; ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>No data has been imported to Residoro yet — this is a preview only.</p>
    </div>
  );
}
