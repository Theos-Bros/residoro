import type { FastifyInstance } from 'fastify';
import { requireAuth, getScopedClient } from '../lib/auth.js';
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
//
// tb-platform-rls-scoped-client-001 / ADR-003 note: this file does NOT get a
// blanket route-wide swap to the scoped client the way most other route
// files do. listing_dockets itself is identity-scoped (shared_by/shared_with
// = auth.uid(), see 20260723110000_listing_dockets.sql) so its own rows are
// safe to read/write with the scoped client -- but three reads here are
// genuinely cross-tenant BY DESIGN (the whole point of this feature) and
// would be silently blocked by properties_select_tenant / listings_select_
// tenant / profiles_select_same_tenant if run through the scoped client:
// looking up the recipient's profile by handle (their tenant isn't the
// sharer's), looking up sharers' profiles for the recipient's inbox (same),
// and joining through to the live listing/property data for a docket whose
// source tenant isn't the recipient's own. Those three stay on supabaseAdmin,
// with the backend's own docket-row checks (already run first) standing in
// for the RLS layer these particular reads can't use.
export async function registerDocketRoutes(app: FastifyInstance) {
  app.post<{ Body: CreateDocketBody }>('/listing-dockets', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
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

    const { data: listing, error: listingError } = await supabase
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

    // Cross-tenant by design -- the recipient is never in the sharer's own
    // tenant, so profiles_select_same_tenant would block this under the
    // scoped client. Stays on supabaseAdmin; see file-level note above.
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

    // tb-listings-co-broker-share-contact-gate-001: the recipient handle
    // resolving to a real account is no longer sufficient -- the sharer must
    // have this person on their own Contacts list (linked by handle) before
    // a docket can be shared with them. This is a read of the sharer's own
    // tenant's contacts, unlike the cross-tenant profile lookup above, so it
    // can safely use the scoped client.
    const { data: linkedContact, error: linkedContactError } = await supabase
      .from('contacts')
      .select('id')
      .eq('tenant_id', request.user!.tenantId)
      .eq('linked_handle', normalizedHandle)
      .maybeSingle();

    if (linkedContactError) {
      request.log.error(linkedContactError);
      return reply.status(500).send({ error: 'Could not verify your contact list' });
    }
    if (!linkedContact) {
      return reply.status(403).send({
        error: 'You can only share with people on your contact list — add @handle as a contact first',
      });
    }

    const { data: docket, error: docketError } = await supabase
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
    // The docket rows themselves are identity-scoped (shared_with =
    // auth.uid()), so this part is safe on the scoped client. The nested
    // listings/properties join is NOT, though -- those tables are
    // tenant-scoped RLS, and a docket's source tenant is (by design) never
    // the recipient's own tenant, so embedding them here would silently come
    // back null under the scoped client. Fetched separately via
    // supabaseAdmin below instead of as a nested select.
    const { data, error } = await getScopedClient(request)
      .from('listing_dockets')
      .select('id, shared_by, included_fields, created_at, source_listing_id')
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
      source_listing_id: string;
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

    const listingIds = [...new Set(rows.map((row) => row.source_listing_id))];
    const { data: listingRows, error: listingsError } =
      listingIds.length > 0
        ? await supabaseAdmin
            .from('listings')
            .select(
              'id, listing_type, price, price_currency, exclusivity, authority_starts_at, authority_expires_at, status, properties(title, type, address, city, province, floor_area_sqm, lot_area_sqm, bedrooms, bathrooms, parking_slots)',
            )
            .in('id', listingIds)
        : { data: [], error: null };

    if (listingsError) {
      request.log.error(listingsError);
      return reply.status(500).send({ error: 'Could not load shared listing details' });
    }
    const listingById = new Map(
      ((listingRows ?? []) as unknown as Array<JoinedListing & { id: string }>).map((l) => [l.id, l]),
    );

    const dockets = rows.map((row) => {
      const listing = listingById.get(row.source_listing_id) ?? null;
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

      const { data, error } = await getScopedClient(request)
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
