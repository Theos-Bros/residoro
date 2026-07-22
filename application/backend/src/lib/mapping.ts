// Replaces gemini.ts's mapping-suggestion role (tb-migration-manual-mapping-001). The
// operator now pre-maps headers to Residoro field names in an external Claude session
// before uploading, so this only needs a simple case-insensitive exact match -- no AI call,
// no confidence score.
import { TARGET_FIELDS } from './transform.js';

export type FieldMapping = { csv_column: string; residoro_field: string };

export type DirectMatchResult = {
  mappings: FieldMapping[];
  unmapped_columns: string[];
};

const FIELD_BY_NORMALIZED_NAME = new Map(TARGET_FIELDS.map((field) => [field.toLowerCase(), field]));

export function directMatchHeaders(headers: string[]): DirectMatchResult {
  const unmapped_columns: string[] = [];

  const mappings = headers.map((csv_column) => {
    const matched = FIELD_BY_NORMALIZED_NAME.get(csv_column.trim().toLowerCase());
    if (!matched) unmapped_columns.push(csv_column);
    return { csv_column, residoro_field: matched ?? 'unmapped' };
  });

  return { mappings, unmapped_columns };
}
