import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

const LISTING_FIELDS = [
  'listing_type',
  'price',
  'price_currency',
  'exclusivity',
  'authority_starts_at',
  'authority_expires_at',
  'status',
] as const;

const PROPERTY_FIELDS = [
  'title',
  'type',
  'address',
  'city',
  'province',
  'floor_area_sqm',
  'lot_area_sqm',
  'bedrooms',
  'bathrooms',
  'parking_slots',
] as const;

const ALLOWED_FIELDS = [...LISTING_FIELDS, ...PROPERTY_FIELDS] as const;
const REVOCABLE_STATUSES = ['revoked'] as const;

type CreateDocketBody = {
  listing_id?: string;
  handle?: string;
  included_fields?: string[];
};

type RevokeDocketBody = {
  status?: string;
};

type JoinedListing = {
  listing_type: string;
  price: number;
  price_currency: string;
  exclusivity: string;
  authority_starts_at: string;
  authority_expires_at: string | null;
  status: string;
  properties: {
    title: string;
    type: string;
    address: string | null;
    city: string | null;
    province: string | null;
    floor_area_sqm: number | null;
    lot_area_sqm: number | null;
    bedrooms: number | null;
    bathrooms: number | null;
    parking_slots: number | null;
  } | null;
};

// tb-listings-co-broker-share-001: the first cross-tenant read in this
// codebase -- a docket's recipient is never in the source listing's own
// tenant. included_fields is validated against a fixed allow-list here (not
// at the DB layer, since which fields are shareable is an application
// concern) and controls visibility only -- GET /listing-dockets/received
// always joins through to the live listings/properties rows, never a stored
// copy, per the user's "live projection" decision (2026-07-23).
export async function registerDocketRoutes(app: FastifyInstance) {
  app.post<{ Body: CreateDocketBody }>('/listing-dockets', { preHandler: requireAuth }, async (request, reply) => {
    const { listing_id, handle, included_fields } = request.body ?? {};

    if (!listing_id || !handle || !included_fields) {
      return reply.status(400).send({ error: 'listing_id, handle, and included_fields are required' });
    }
    if (!Array.isArray(included_fields) || included_fields.length === 0) {
      return reply.status(400).send({ error: 'included_fields must be a non-empty array' });
    }
    const invalidField = included_fields.find((field) => !(ALLOWED_FIELDS as readonly string[]).includes(field));
    if (invalidField) {
      return reply.status(400).send({ error: `Unknown field: ${invalidField}` });
    }

    const { data: listing, error: listingError } = await supabaseAdmin
      .from('listings')
      .select('id')
      .eq('id', listing_id)
      .eq('tenant_id', request.user!.tenantId)
      .maybeSingle();

    if (listingError) {
      request.log.error(listingError);
      return reply.status(500).send({ error: 'Could not verify the listing' });
    }
    if (!listing) {
      return reply.status(404).send({ error: 'Listing not found in your workspace' });
    }

    const normalizedHandle = handle.trim().toLowerCase();
    const { data: recipient, error: recipientError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('handle', normalizedHandle)
      .maybeSingle();

    if (recipientError) {
      request.log.error(recipientError);
      return reply.status(500).send({ error: 'Could not look up that handle' });
    }
    if (!recipient) {
      return reply.status(404).send({ error: 'No account found with that handle' });
    }
    if (recipient.id === request.user!.id) {
      return reply.status(400).send({ error: 'You cannot share a docket with yourself' });
    }

    const { data: docket, error: docketError } = await supabaseAdmin
      .from('listing_dockets')
      .insert({
        source_listing_id: listing_id,
        source_tenant_id: request.user!.tenantId,
        shared_by: request.user!.id,
        shared_with: recipient.id,
        included_fields,
      })
      .select('id, source_listing_id, shared_with, included_fields, status, created_at')
      .single();

    if (docketError || !docket) {
      request.log.error(docketError);
      return reply.status(500).send({ error: 'Could not create the docket' });
    }

    return reply.status(201).send(docket);
  });

  app.get('/listing-dockets/received', { preHandler: requireAuth }, async (request, reply) => {
    const { data, error } = await supabaseAdmin
      .from('listing_dockets')
      .select(
        'id, shared_by, included_fields, created_at, listings(listing_type, price, price_currency, exclusivity, authority_starts_at, authority_expires_at, status, properties(title, type, address, city, province, floor_area_sqm, lot_area_sqm, bedrooms, bathrooms, parking_slots))',
      )
      .eq('shared_with', request.user!.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load shared dockets' });
    }

    const rows = data as unknown as Array<{
      id: string;
      shared_by: string;
      included_fields: string[];
      created_at: string;
      listings: JoinedListing | null;
    }>;

    const sharerIds = [...new Set(rows.map((row) => row.shared_by))];
    const { data: sharers, error: sharersError } =
      sharerIds.length > 0
        ? await supabaseAdmin.from('profiles').select('id, handle').in('id', sharerIds)
        : { data: [], error: null };

    if (sharersError) {
      request.log.error(sharersError);
      return reply.status(500).send({ error: 'Could not load sharer info' });
    }
    const handleById = new Map((sharers ?? []).map((sharer) => [sharer.id, sharer.handle]));

    const dockets = rows.map((row) => {
      const listing = row.listings;
      const property = listing?.properties ?? null;
      const fields: Record<string, unknown> = {};

      for (const field of row.included_fields) {
        if ((LISTING_FIELDS as readonly string[]).includes(field)) {
          fields[field] = listing ? (listing as unknown as Record<string, unknown>)[field] : null;
        } else if ((PROPERTY_FIELDS as readonly string[]).includes(field)) {
          fields[field] = property ? (property as unknown as Record<string, unknown>)[field] : null;
        }
      }

      return {
        id: row.id,
        shared_by_handle: handleById.get(row.shared_by) ?? null,
        fields,
        created_at: row.created_at,
      };
    });

    return { dockets };
  });

  app.patch<{ Params: { id: string }; Body: RevokeDocketBody }>(
    '/listing-dockets/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { status } = request.body ?? {};

      if (!status || !REVOCABLE_STATUSES.includes(status as (typeof REVOCABLE_STATUSES)[number])) {
        return reply.status(400).send({ error: "status must be 'revoked'" });
      }

      const { data, error } = await supabaseAdmin
        .from('listing_dockets')
        .update({ status })
        .eq('id', request.params.id)
        .eq('shared_by', request.user!.id)
        .select('id, status')
        .maybeSingle();

      if (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not revoke the docket' });
      }
      if (!data) {
        return reply.status(404).send({ error: 'Docket not found' });
      }

      return data;
    },
  );
}
