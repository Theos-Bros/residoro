import type { FastifyInstance } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { requireAuth, getScopedClient } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

const BUCKET = 'property-documents';
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
// Wider than property_media's image-only allowlist -- title/tax documents
// are commonly scanned as PDF rather than photographed.
const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
const DOCUMENT_TYPES = ['title_deed', 'tax_declaration', 'other'] as const;
type DocumentType = (typeof DOCUMENT_TYPES)[number];
const SIGNED_URL_TTL_SECONDS = 3600;

type PropertyDocumentRow = {
  id: string;
  property_id: string;
  document_type: DocumentType;
  storage_path: string;
  file_name: string;
  created_at: string;
};

// Same "never trust tenant scoping from the URL alone" precedent as
// propertyMedia.ts and listings.ts.
async function loadOwnedProperty(supabase: SupabaseClient, tenantId: string, propertyId: string) {
  return supabase.from('properties').select('id').eq('id', propertyId).eq('tenant_id', tenantId).maybeSingle();
}

// Storage calls stay on supabaseAdmin -- same reasoning as propertyMedia.ts:
// the property-documents bucket only has a SELECT storage.objects policy
// (20260727100000_property_documents.sql), no INSERT/DELETE policy.
async function signDocumentUrl(storagePath: string): Promise<string | undefined> {
  const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  return data?.signedUrl;
}

// document_type travels as a plain form field alongside the file in the same
// multipart upload -- @fastify/multipart's request.file() collects value
// fields it sees before the file part into file.fields, same precedent as
// migrations.ts's entity_type. The frontend must append document_type ahead
// of the file in its FormData.
function resolveDocumentType(file: MultipartFile): DocumentType | null {
  const field = file.fields.document_type;
  const entry = Array.isArray(field) ? field[0] : field;
  if (!entry || entry.type !== 'field') return null;
  const raw = String(entry.value);
  return (DOCUMENT_TYPES as readonly string[]).includes(raw) ? (raw as DocumentType) : null;
}

export async function registerPropertyDocumentsRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>(
    '/properties/:id/documents',
    { preHandler: requireAuth },
    async (request, reply) => {
      const supabase = getScopedClient(request);
      const { data: property, error: propertyError } = await loadOwnedProperty(
        supabase,
        request.user!.tenantId,
        request.params.id,
      );
      if (propertyError) {
        request.log.error(propertyError);
        return reply.status(500).send({ error: 'Could not verify the property' });
      }
      if (!property) {
        return reply.status(404).send({ error: 'Property not found in your workspace' });
      }

      const { data: rows, error } = await supabase
        .from('property_documents')
        .select('id, property_id, document_type, storage_path, file_name, created_at')
        .eq('property_id', request.params.id)
        .order('created_at');

      if (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not load documents' });
      }

      const documents = await Promise.all(
        ((rows ?? []) as PropertyDocumentRow[]).map(async (row) => ({
          id: row.id,
          property_id: row.property_id,
          document_type: row.document_type,
          file_name: row.file_name,
          created_at: row.created_at,
          url: await signDocumentUrl(row.storage_path),
        })),
      );

      return { documents };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/properties/:id/documents',
    { preHandler: requireAuth },
    async (request, reply) => {
      const supabase = getScopedClient(request);
      const { data: property, error: propertyError } = await loadOwnedProperty(
        supabase,
        request.user!.tenantId,
        request.params.id,
      );
      if (propertyError) {
        request.log.error(propertyError);
        return reply.status(500).send({ error: 'Could not verify the property' });
      }
      if (!property) {
        return reply.status(404).send({ error: 'Property not found in your workspace' });
      }

      const file = await request.file({ limits: { fileSize: MAX_FILE_SIZE_BYTES } });
      if (!file) {
        return reply.status(400).send({ error: 'No file uploaded' });
      }
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype as (typeof ALLOWED_MIME_TYPES)[number])) {
        return reply.status(400).send({ error: 'Only PDF, JPEG, PNG, or WebP files are allowed' });
      }

      const documentType = resolveDocumentType(file);
      if (documentType === null) {
        return reply.status(400).send({ error: 'document_type must be title_deed, tax_declaration, or other' });
      }

      const buffer = await file.toBuffer();
      if (file.file.truncated) {
        return reply.status(413).send({ error: `File exceeds the ${MAX_FILE_SIZE_BYTES} byte limit` });
      }

      const ext = file.mimetype.split('/')[1];
      const storagePath = `${request.user!.tenantId}/${request.params.id}/${randomUUID()}.${ext}`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(storagePath, buffer, { contentType: file.mimetype });
      if (uploadError) {
        request.log.error(uploadError);
        return reply.status(500).send({ error: 'Upload failed' });
      }

      const { data: row, error: insertError } = await supabase
        .from('property_documents')
        .insert({
          tenant_id: request.user!.tenantId,
          property_id: request.params.id,
          document_type: documentType,
          storage_path: storagePath,
          file_name: file.filename,
          created_by: request.user!.id,
        })
        .select('id, property_id, document_type, storage_path, file_name, created_at')
        .single<PropertyDocumentRow>();

      if (insertError || !row) {
        request.log.error(insertError);
        return reply.status(500).send({ error: 'Could not save document record' });
      }

      return reply.status(201).send({
        id: row.id,
        property_id: row.property_id,
        document_type: row.document_type,
        file_name: row.file_name,
        created_at: row.created_at,
        url: await signDocumentUrl(row.storage_path),
      });
    },
  );

  // No cover-reassignment step afterward, unlike property_media -- documents
  // have no cover concept.
  app.delete<{ Params: { id: string; documentId: string } }>(
    '/properties/:id/documents/:documentId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const supabase = getScopedClient(request);
      const { data: property, error: propertyError } = await loadOwnedProperty(
        supabase,
        request.user!.tenantId,
        request.params.id,
      );
      if (propertyError) {
        request.log.error(propertyError);
        return reply.status(500).send({ error: 'Could not verify the property' });
      }
      if (!property) {
        return reply.status(404).send({ error: 'Property not found in your workspace' });
      }

      const { data: row, error: rowError } = await supabase
        .from('property_documents')
        .select('id, storage_path')
        .eq('id', request.params.documentId)
        .eq('property_id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .maybeSingle<{ id: string; storage_path: string }>();

      if (rowError) {
        request.log.error(rowError);
        return reply.status(500).send({ error: 'Could not load document' });
      }
      if (!row) {
        return reply.status(404).send({ error: 'Document not found' });
      }

      const { error: removeError } = await supabaseAdmin.storage.from(BUCKET).remove([row.storage_path]);
      if (removeError) {
        request.log.error(removeError);
        return reply.status(500).send({ error: 'Could not delete document file' });
      }

      const { error: deleteError } = await supabase.from('property_documents').delete().eq('id', row.id);
      if (deleteError) {
        request.log.error(deleteError);
        return reply.status(500).send({ error: 'Could not delete document record' });
      }

      return { success: true };
    },
  );
}
