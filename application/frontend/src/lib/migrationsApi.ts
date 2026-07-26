const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

// tb-migration-contacts-001: which entity a migration writes into. Threaded
// through every call so upload/analyze/preview/import all agree on it.
export type EntityType = 'property' | 'contact';

export type FieldMapping = {
  csv_column: string;
  residoro_field: string;
};

export type UploadResult = {
  file_id: string;
  filename: string;
  rows_detected: number;
  columns: string[];
  status: string;
  expires_at: string;
};

export type AnalyzeResult = {
  file_id: string;
  mappings: FieldMapping[];
  unmapped_columns: string[];
  status: string;
};

export type PreviewProperty = {
  row_number: number;
  validation_errors: string[];
  [field: string]: unknown;
};

// tb-migration-deduplication-001: 'skip' (default) leaves the existing
// property untouched, 'create_new' imports the row as a duplicate anyway,
// 'overwrite' updates the existing property's fields in place. Properties
// only -- a contacts migration's conflicts array is always empty.
export type ConflictResolution = 'skip' | 'create_new' | 'overwrite';

export type PreviewConflict = {
  row_number: number;
  address: unknown;
  city: unknown;
  province: unknown;
  existing_property_id: string;
  existing_title: string;
  resolution: ConflictResolution;
};

export type PreviewResult = {
  file_id: string;
  total_rows: number;
  sample_properties: PreviewProperty[];
  total_validation_errors: number;
  total_conflicts: number;
  conflicts: PreviewConflict[];
  status: string;
};

async function parseJsonOrThrow(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

// tb-client-lifecycle-migration-execution-001: an operator passes the
// client's tenant they selected in the admin dashboard; a brokerage caller
// (legacy self-service path, no longer reachable from the UI) omits it and
// is scoped to their own session tenant server-side, unaffected by this.
function withTenant(path: string, tenantId?: string): string {
  return tenantId ? `${BACKEND_URL}${path}?tenant_id=${encodeURIComponent(tenantId)}` : `${BACKEND_URL}${path}`;
}

export async function uploadCsv(
  accessToken: string,
  file: File,
  entityType: EntityType,
  tenantId?: string,
): Promise<UploadResult> {
  const formData = new FormData();
  // entity_type must be appended before file: the backend reads it off
  // @fastify/multipart's file.fields, which only captures fields seen before
  // the file part in the stream.
  formData.append('entity_type', entityType);
  formData.append('file', file);

  const response = await fetch(withTenant('/migrations/upload', tenantId), {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });
  return parseJsonOrThrow(response);
}

export async function analyzeMappings(accessToken: string, fileId: string, tenantId?: string): Promise<AnalyzeResult> {
  const response = await fetch(withTenant(`/migrations/${fileId}/analyze`, tenantId), {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function previewMappings(
  accessToken: string,
  fileId: string,
  mappings: { csv_column: string; residoro_field: string }[],
  tenantId?: string,
): Promise<PreviewResult> {
  const response = await fetch(withTenant(`/migrations/${fileId}/preview`, tenantId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mappings }),
  });
  return parseJsonOrThrow(response);
}

export type ImportResult = {
  batch_id: string;
  status: string;
  total_rows: number;
  successful_imports: number;
  failed_rows: number;
  skipped_rows: number;
  updated_rows: number;
};

export type FailedRowDetail = {
  original_row: Record<string, string>;
  error_message: string;
};

export type BatchDetail = {
  batch_id: string;
  filename: string;
  status: string;
  total_rows: number;
  successful_imports: number;
  failed_rows: number;
  skipped_rows: number;
  updated_rows: number;
  rollback_deadline: string;
  failed_row_details: FailedRowDetail[];
};

// tb-migration-preview-001: the confirm step tb-migration-csv-001 stubbed out
// ("Importing into Residoro is not built yet") -- this is that build.
// tb-migration-deduplication-001: resolutions carries the operator's per-row
// skip/create_new/overwrite choice for any row the preview step flagged as a
// conflict, keyed by row_number; omitted entirely for a contacts migration.
export async function confirmImport(
  accessToken: string,
  fileId: string,
  tenantId?: string,
  resolutions?: Record<number, ConflictResolution>,
): Promise<ImportResult> {
  const response = await fetch(withTenant(`/migrations/${fileId}/import`, tenantId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ resolutions: resolutions ?? {} }),
  });
  return parseJsonOrThrow(response);
}

export async function fetchImportBatch(accessToken: string, batchId: string, tenantId?: string): Promise<BatchDetail> {
  const response = await fetch(withTenant(`/migrations/batches/${batchId}`, tenantId), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}
