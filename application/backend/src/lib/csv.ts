import { parse } from 'csv-parse/sync';

export type ParsedCsv = {
  headers: string[];
  rows: Record<string, string>[];
};

export function parseCsv(content: string): ParsedCsv {
  const rows = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { headers, rows };
}
