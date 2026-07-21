import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { parseCsv } from '../lib/csv.js';
import { suggestFieldMappings } from '../lib/gemini.js';
import { transformSample, type MappingEntry } from '../lib/transform.js';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 10_000;
const SAMPLE_ROW_COUNT = 3;
const PREVIEW_ROW_COUNT = 5;

type MigrationTempFileRow = {
  id: string;
  headers: string[];
  sample_rows: Record<string, string>[];
  raw_content: string;
  row_count: number;
  expires_at: string;
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

      const result = await suggestFieldMappings(row.headers, row.sample_rows);

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
        warnings: result.warnings,
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
}
