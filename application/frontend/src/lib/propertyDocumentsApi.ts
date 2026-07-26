const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type DocumentType = 'title_deed' | 'tax_declaration' | 'other';

export type PropertyDocument = {
  id: string;
  property_id: string;
  document_type: DocumentType;
  file_name: string;
  created_at: string;
  url?: string;
};

async function parseJsonOrThrow(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

export async function fetchPropertyDocuments(
  accessToken: string,
  propertyId: string,
): Promise<{ documents: PropertyDocument[] }> {
  const response = await fetch(`${BACKEND_URL}/properties/${propertyId}/documents`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function uploadPropertyDocument(
  accessToken: string,
  propertyId: string,
  file: File,
  documentType: DocumentType,
): Promise<PropertyDocument> {
  const formData = new FormData();
  // document_type must be appended before file -- @fastify/multipart's
  // request.file() only collects field parts it has already seen into
  // file.fields, same precedent as the CSV migration upload's entity_type.
  formData.append('document_type', documentType);
  formData.append('file', file);

  const response = await fetch(`${BACKEND_URL}/properties/${propertyId}/documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });
  return parseJsonOrThrow(response);
}

export async function deletePropertyDocument(
  accessToken: string,
  propertyId: string,
  documentId: string,
): Promise<{ success: boolean }> {
  const response = await fetch(`${BACKEND_URL}/properties/${propertyId}/documents/${documentId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}
