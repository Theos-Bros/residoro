import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { parseCsv } from '../lib/csv.js';
import { directMatchHeaders } from '../lib/mapping.js';
import { transformSample, type MappingEntry } from '../lib/transform.js';
import { sendImportSummaryEmail } from '../lib/email.js';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 10_000;
const SAMPLE_ROW_COUNT = 3;
const PREVIEW_ROW_COUNT = 5;
const ROLLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

// Columns properties.NOT NULL requires that transformSample doesn't already
// surface a validation error for when unmapped (transformSample only
// validates fields that ARE mapped -- a field missing from the mapping
// entirely produces no error, but would still fail the DB's NOT NULL check
// with a raw, unhelpful Postgres error instead of a per-row message).
const REQUIRED_PROPERTY_FIELDS = ['title', 'type', 'owner_type'] as const;

type MigrationTempFileRow = {
  id: string;
  headers: string[];
  sample_rows: Record<string, string>[];
  raw_content: string;
  row_count: number;
  expires_at: string;
};

type ConfirmedMigrationTempFileRow = MigrationTempFileRow & {
  filename: string;
  status: string;
  user_confirmed_mappings: MappingEntry[] | null;
};

function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() < Date.now();
}

export async function registerMigrationRoutes(app: FastifyInstance) {
  app.post('/migrations/upload', { preHandler: requireAuth }, async (request, reply) => {
    const file = await request.file({ limits: { fileSize: MAX_FILE_SIZE_BYTES } });
    if (!file) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }
    if (!file.filename.toLowerCase().endsWith('.csv')) {
      return reply.status(400).send({ error: 'Only CSV files are supported for v1' });
    }

    const buffer = await file.toBuffer();
    if (file.file.truncated) {
      return reply.status(413).send({ error: `File exceeds the ${MAX_FILE_SIZE_BYTES} byte limit` });
    }

    const content = buffer.toString('utf-8');
    let parsed: ReturnType<typeof parseCsv>;
    try {
      parsed = parseCsv(content);
    } catch (err) {
      return reply.status(400).send({ error: 'Could not parse CSV', detail: (err as Error).message });
    }

    if (parsed.rows.length === 0) {
      return reply.status(400).send({ error: 'CSV has no data rows' });
    }
    if (parsed.rows.length > MAX_ROWS) {
      return reply
        .status(400)
        .send({ error: `CSV exceeds the ${MAX_ROWS} row limit`, rows_detected: parsed.rows.length });
    }

    const { data, error } = await supabaseAdmin
      .from('migration_temp_files')
      .insert({
        tenant_id: request.user!.tenantId,
        filename: file.filename,
        file_size_bytes: buffer.byteLength,
        raw_content: content,
        headers: parsed.headers,
        sample_rows: parsed.rows.slice(0, SAMPLE_ROW_COUNT),
        row_count: parsed.rows.length,
        created_by: request.user!.id,
      })
      .select('id, filename, expires_at')
      .single();

    if (error || !data) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not save the uploaded file' });
    }

    return {
      file_id: data.id,
      filename: data.filename,
      rows_detected: parsed.rows.length,
      columns: parsed.headers,
      status: 'uploaded',
      expires_at: data.expires_at,
    };
  });

  app.post<{ Params: { fileId: string } }>(
    '/migrations/:fileId/analyze',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { data: row, error } = await supabaseAdmin
        .from('migration_temp_files')
        .select('id, headers, sample_rows, raw_content, row_count, expires_at')
        .eq('id', request.params.fileId)
        .eq('tenant_id', request.user!.tenantId)
        .single<MigrationTempFileRow>();

      if (error || !row || isExpired(row.expires_at)) {
        return reply.status(404).send({ error: 'File not found or expired — please re-upload' });
      }

      const result = directMatchHeaders(row.headers);

      const { error: updateError } = await supabaseAdmin
        .from('migration_temp_files')
        .update({ claude_suggested_mappings: result, status: 'analyzed' })
        .eq('id', row.id);

      if (updateError) {
        request.log.error(updateError);
        return reply.status(500).send({ error: 'Could not save the analysis' });
      }

      return {
        file_id: row.id,
        mappings: result.mappings,
        unmapped_columns: result.unmapped_columns,
        status: 'ready_for_preview',
      };
    },
  );

  app.post<{ Params: { fileId: string }; Body: { mappings: MappingEntry[] } }>(
    '/migrations/:fileId/preview',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { mappings } = request.body;
      if (!Array.isArray(mappings) || mappings.length === 0) {
        return reply.status(400).send({ error: 'mappings is required' });
      }

      const { data: row, error } = await supabaseAdmin
        .from('migration_temp_files')
        .select('id, headers, sample_rows, raw_content, row_count, expires_at')
        .eq('id', request.params.fileId)
        .eq('tenant_id', request.user!.tenantId)
        .single<MigrationTempFileRow>();

      if (error || !row || isExpired(row.expires_at)) {
        return reply.status(404).send({ error: 'File not found or expired — please re-upload' });
      }

      const { rows } = parseCsv(row.raw_content);
      const { sampleProperties, errorCount } = transformSample(rows.slice(0, PREVIEW_ROW_COUNT), mappings);

      const { error: updateError } = await supabaseAdmin
        .from('migration_temp_files')
        .update({ user_confirmed_mappings: mappings, preview_data: sampleProperties, status: 'previewed' })
        .eq('id', row.id);

      if (updateError) {
        request.log.error(updateError);
        return reply.status(500).send({ error: 'Could not save the preview' });
      }

      return {
        file_id: row.id,
        total_rows: row.row_count,
        sample_properties: sampleProperties,
        total_validation_errors: errorCount,
        status: 'ready_for_confirmation',
      };
    },
  );

  // tb-migration-preview-001: the confirm step TB-1/tb-migration-csv-001
  // never built -- migration_temp_files' own comment flagged "never written
  // to properties from here -- that is a later tracer bullet." This is that
  // tracer bullet. Runs synchronously in the request (no job queue exists
  // yet in this codebase) -- acceptable for a tracer bullet at the existing
  // 10,000-row cap, revisit if that proves too slow in practice.
  app.post<{ Params: { fileId: string } }>(
    '/migrations/:fileId/import',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { data: row, error } = await supabaseAdmin
        .from('migration_temp_files')
        .select('id, headers, sample_rows, raw_content, row_count, expires_at, filename, status, user_confirmed_mappings')
        .eq('id', request.params.fileId)
        .eq('tenant_id', request.user!.tenantId)
        .single<ConfirmedMigrationTempFileRow>();

      if (error || !row || isExpired(row.expires_at)) {
        return reply.status(404).send({ error: 'File not found or expired — please re-upload' });
      }
      if (row.status !== 'previewed' || !row.user_confirmed_mappings) {
        return reply.status(400).send({
          error: `File must be previewed and confirmed before import (current status: ${row.status})`,
        });
      }

      const { rows } = parseCsv(row.raw_content);
      const { sampleProperties: transformed } = transformSample(rows, row.user_confirmed_mappings);

      const { data: batch, error: batchError } = await supabaseAdmin
        .from('import_batches')
        .insert({
          tenant_id: request.user!.tenantId,
          temp_file_id: row.id,
          filename: row.filename,
          total_rows: row.row_count,
          mapping_config: row.user_confirmed_mappings,
          rollback_deadline: new Date(Date.now() + ROLLBACK_WINDOW_MS).toISOString(),
          created_by: request.user!.id,
        })
        .select('id')
        .single();

      if (batchError || !batch) {
        request.log.error(batchError);
        return reply.status(500).send({ error: 'Could not create the import batch' });
      }

      let successCount = 0;
      let failCount = 0;

      for (const item of transformed) {
        const { row_number, validation_errors, ...mappedData } = item as Record<string, unknown> & {
          row_number: number;
          validation_errors: string[];
        };
        const originalRow = rows[row_number - 1];
        const missingField = REQUIRED_PROPERTY_FIELDS.find((field) => mappedData[field] == null);

        if (validation_errors.length > 0 || missingField) {
          failCount += 1;
          const errorMessage = missingField
            ? [...validation_errors, `Missing required field: ${missingField}`].join('; ')
            : validation_errors.join('; ');
          await supabaseAdmin.from('imported_properties').insert({
            batch_id: batch.id,
            original_row: originalRow,
            mapped_data: mappedData,
            status: 'error',
            error_message: errorMessage,
          });
          continue;
        }

        const { data: property, error: propertyError } = await supabaseAdmin
          .from('properties')
          .insert({ ...mappedData, tenant_id: request.user!.tenantId })
          .select('id')
          .single();

        if (propertyError || !property) {
          failCount += 1;
          request.log.error(propertyError);
          await supabaseAdmin.from('imported_properties').insert({
            batch_id: batch.id,
            original_row: originalRow,
            mapped_data: mappedData,
            status: 'error',
            error_message: propertyError?.message ?? 'Could not create property',
          });
          continue;
        }

        successCount += 1;
        await supabaseAdmin.from('imported_properties').insert({
          batch_id: batch.id,
          property_id: property.id,
          original_row: originalRow,
          mapped_data: mappedData,
          status: 'success',
        });
      }

      await supabaseAdmin
        .from('import_batches')
        .update({
          status: 'complete',
          imported_at: new Date().toISOString(),
          successful_imports: successCount,
          failed_rows: failCount,
        })
        .eq('id', batch.id);

      await supabaseAdmin.from('migration_temp_files').update({ status: 'confirmed' }).eq('id', row.id);

      const frontendUrl = process.env.FRONTEND_URL;
      const { data: userData } = await supabaseAdmin.auth.admin.getUserById(request.user!.id);
      if (userData.user?.email && frontendUrl) {
        await sendImportSummaryEmail({
          to: userData.user.email,
          filename: row.filename,
          totalRows: row.row_count,
          successfulImports: successCount,
          failedRows: failCount,
          batchDetailUrl: `${frontendUrl}/migrations/batches/${batch.id}`,
        });
      } else {
        request.log.error('Could not resolve uploader email or FRONTEND_URL — skipping import summary email');
      }

      return {
        batch_id: batch.id,
        status: 'complete',
        total_rows: row.row_count,
        successful_imports: successCount,
        failed_rows: failCount,
      };
    },
  );

  app.get<{ Params: { batchId: string } }>(
    '/migrations/batches/:batchId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { data: batch, error } = await supabaseAdmin
        .from('import_batches')
        .select('id, filename, status, total_rows, successful_imports, failed_rows, rollback_deadline')
        .eq('id', request.params.batchId)
        .eq('tenant_id', request.user!.tenantId)
        .single();

      if (error || !batch) {
        return reply.status(404).send({ error: 'Import batch not found' });
      }

      const { data: failedRows, error: failedRowsError } = await supabaseAdmin
        .from('imported_properties')
        .select('original_row, error_message')
        .eq('batch_id', batch.id)
        .eq('status', 'error');

      if (failedRowsError) {
        request.log.error(failedRowsError);
        return reply.status(500).send({ error: 'Could not load failed rows' });
      }

      return {
        batch_id: batch.id,
        filename: batch.filename,
        status: batch.status,
        total_rows: batch.total_rows,
        successful_imports: batch.successful_imports,
        failed_rows: batch.failed_rows,
        rollback_deadline: batch.rollback_deadline,
        failed_row_details: (failedRows ?? []).map((r) => ({
          original_row: r.original_row,
          error_message: r.error_message,
        })),
      };
    },
  );
}
