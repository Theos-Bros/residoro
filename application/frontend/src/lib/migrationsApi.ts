const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

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

export type PreviewResult = {
  file_id: string;
  total_rows: number;
  sample_properties: PreviewProperty[];
  total_validation_errors: number;
  status: string;
};

async function parseJsonOrThrow(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

export async function uploadCsv(accessToken: string, file: File): Promise<UploadResult> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${BACKEND_URL}/migrations/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });
  return parseJsonOrThrow(response);
}

export async function analyzeMappings(accessToken: string, fileId: string): Promise<AnalyzeResult> {
  const response = await fetch(`${BACKEND_URL}/migrations/${fileId}/analyze`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function previewMappings(
  accessToken: string,
  fileId: string,
  mappings: { csv_column: string; residoro_field: string }[],
): Promise<PreviewResult> {
  const response = await fetch(`${BACKEND_URL}/migrations/${fileId}/preview`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mappings }),
  });
  return parseJsonOrThrow(response);
}
