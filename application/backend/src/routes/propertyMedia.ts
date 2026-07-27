import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

const BUCKET = 'property-media';
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const SIGNED_URL_TTL_SECONDS = 3600;

type PropertyMediaRow = {
  id: string;
  property_id: string;
  storage_path: string;
  sort_order: number;
  is_cover: boolean;
  created_at: string;
};

type UpdateMediaBody = {
  sort_order?: number;
  is_cover?: boolean;
};

// Every route below re-verifies property_id against the caller's own
// tenant_id before touching property_media -- same "never trust tenant
// scoping from the URL/body alone" precedent as listings.ts.
async function loadOwnedProperty(tenantId: string, propertyId: string) {
  return supabaseAdmin.from('properties').select('id').eq('id', propertyId).eq('tenant_id', tenantId).maybeSingle();
}

async function signMediaUrl(storagePath: string): Promise<string | undefined> {
  const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  return data?.signedUrl;
}

// tb-properties-photos-001: no dedicated single-property GET endpoint
// existed before this -- GET /properties only ever returned the whole list
// (tb-listings-create-001). PropertyDetailPage needs to fetch one property
// standalone (e.g. on a page refresh, without the list already in memory).
export async function registerPropertyMediaRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/properties/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { data: property, error } = await supabaseAdmin
      .from('properties')
      .select(
        'id, title, type, address, city, province, floor_area_sqm, lot_area_sqm, bedrooms, bathrooms, parking_slots, price, price_currency, status, verification_status, owner_type, owner_id, project_id, projects(name)',
      )
      .eq('id', request.params.id)
      .eq('tenant_id', request.user!.tenantId)
      .maybeSingle();

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load the property' });
    }
    if (!property) {
      return reply.status(404).send({ error: 'Property not found in your workspace' });
    }

    // tb-properties-project-001: project_name is a convenience join, not a
    // stored column -- null for every property until one is assigned to a
    // project (project_id stays null for resale properties, unchanged).
    const { projects, ...rest } = property as unknown as Record<string, unknown> & {
      projects: { name: string } | null;
    };
    return { ...rest, project_name: projects?.name ?? null };
  });

  app.get<{ Params: { id: string } }>(
    '/properties/:id/media',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { data: property, error: propertyError } = await loadOwnedProperty(
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

      const { data: rows, error } = await supabaseAdmin
        .from('property_media')
        .select('id, property_id, storage_path, sort_order, is_cover, created_at')
        .eq('property_id', request.params.id)
        .order('sort_order');

      if (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not load photos' });
      }

      const media = await Promise.all(
        ((rows ?? []) as PropertyMediaRow[]).map(async (row) => ({
          id: row.id,
          property_id: row.property_id,
          sort_order: row.sort_order,
          is_cover: row.is_cover,
          created_at: row.created_at,
          url: await signMediaUrl(row.storage_path),
        })),
      );

      return { media };
    },
  );

  // The first photo uploaded to a property becomes its cover automatically;
  // every later upload leaves the existing cover alone.
  app.post<{ Params: { id: string } }>(
    '/properties/:id/media',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { data: property, error: propertyError } = await loadOwnedProperty(
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
        return reply.status(400).send({ error: 'Only JPEG, PNG, or WebP images are allowed' });
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

      const { count, error: countError } = await supabaseAdmin
        .from('property_media')
        .select('id', { count: 'exact', head: true })
        .eq('property_id', request.params.id);
      if (countError) {
        request.log.error(countError);
        return reply.status(500).send({ error: 'Could not save photo record' });
      }

      const { data: row, error: insertError } = await supabaseAdmin
        .from('property_media')
        .insert({
          tenant_id: request.user!.tenantId,
          property_id: request.params.id,
          storage_path: storagePath,
          sort_order: count ?? 0,
          is_cover: (count ?? 0) === 0,
          created_by: request.user!.id,
        })
        .select('id, property_id, storage_path, sort_order, is_cover, created_at')
        .single<PropertyMediaRow>();

      if (insertError || !row) {
        request.log.error(insertError);
        return reply.status(500).send({ error: 'Could not save photo record' });
      }

      return reply.status(201).send({
        id: row.id,
        property_id: row.property_id,
        sort_order: row.sort_order,
        is_cover: row.is_cover,
        created_at: row.created_at,
        url: await signMediaUrl(row.storage_path),
      });
    },
  );

  // Setting is_cover: true unsets every other photo's cover flag on the same
  // property first, so exactly one photo is ever marked cover.
  app.patch<{ Params: { id: string; mediaId: string }; Body: UpdateMediaBody }>(
    '/properties/:id/media/:mediaId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { data: property, error: propertyError } = await loadOwnedProperty(
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

      const { sort_order, is_cover } = request.body ?? {};
      if (sort_order === undefined && is_cover === undefined) {
        return reply.status(400).send({ error: 'sort_order or is_cover is required' });
      }
      if (sort_order !== undefined && (typeof sort_order !== 'number' || !Number.isInteger(sort_order))) {
        return reply.status(400).send({ error: 'sort_order must be an integer' });
      }

      if (is_cover === true) {
        const { error: clearError } = await supabaseAdmin
          .from('property_media')
          .update({ is_cover: false })
          .eq('property_id', request.params.id)
          .eq('tenant_id', request.user!.tenantId);
        if (clearError) {
          request.log.error(clearError);
          return reply.status(500).send({ error: 'Could not update cover photo' });
        }
      }

      const { data: row, error } = await supabaseAdmin
        .from('property_media')
        .update({
          ...(sort_order !== undefined && { sort_order }),
          ...(is_cover !== undefined && { is_cover }),
        })
        .eq('id', request.params.mediaId)
        .eq('property_id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .select('id, property_id, storage_path, sort_order, is_cover, created_at')
        .maybeSingle<PropertyMediaRow>();

      if (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not update photo' });
      }
      if (!row) {
        return reply.status(404).send({ error: 'Photo not found' });
      }

      return {
        id: row.id,
        property_id: row.property_id,
        sort_order: row.sort_order,
        is_cover: row.is_cover,
        created_at: row.created_at,
        url: await signMediaUrl(row.storage_path),
      };
    },
  );

  // Deleting the current cover promotes the next-lowest sort_order photo to
  // cover automatically, so a property with any photos always has exactly
  // one cover (or zero, only once every photo is gone).
  app.delete<{ Params: { id: string; mediaId: string } }>(
    '/properties/:id/media/:mediaId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { data: property, error: propertyError } = await loadOwnedProperty(
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

      const { data: row, error: rowError } = await supabaseAdmin
        .from('property_media')
        .select('id, storage_path, is_cover')
        .eq('id', request.params.mediaId)
        .eq('property_id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .maybeSingle<{ id: string; storage_path: string; is_cover: boolean }>();

      if (rowError) {
        request.log.error(rowError);
        return reply.status(500).send({ error: 'Could not load photo' });
      }
      if (!row) {
        return reply.status(404).send({ error: 'Photo not found' });
      }

      const { error: removeError } = await supabaseAdmin.storage.from(BUCKET).remove([row.storage_path]);
      if (removeError) {
        request.log.error(removeError);
        return reply.status(500).send({ error: 'Could not delete photo file' });
      }

      const { error: deleteError } = await supabaseAdmin.from('property_media').delete().eq('id', row.id);
      if (deleteError) {
        request.log.error(deleteError);
        return reply.status(500).send({ error: 'Could not delete photo record' });
      }

      if (row.is_cover) {
        const { data: next } = await supabaseAdmin
          .from('property_media')
          .select('id')
          .eq('property_id', request.params.id)
          .eq('tenant_id', request.user!.tenantId)
          .order('sort_order')
          .limit(1)
          .maybeSingle<{ id: string }>();

        if (next) {
          await supabaseAdmin.from('property_media').update({ is_cover: true }).eq('id', next.id);
        }
      }

      return { success: true };
    },
  );
}
