import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

const LISTING_TYPES = ['sale', 'rent'] as const;
const STATUSES = ['draft', 'active', 'under_offer', 'sold', 'expired', 'withdrawn'] as const;
const EXCLUSIVITY_VALUES = ['exclusive', 'open'] as const;

// tb-listings-lifecycle-001: the real state machine cap-listings-001
// Milestone 3 names. draft/active/withdrawn-only (tb-listings-create-001)
// allowed any status write; this closes that gap. sold/expired/withdrawn are
// terminal -- no further transitions once a listing lands there. Reassigning
// a listing to a new agent is NOT a transition here: it's withdrawing this
// row (active -> withdrawn) and POSTing a brand-new listing on the same
// property, per cap-listings-001's "closing one and creating another"
// framing.
const STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ['active', 'withdrawn'],
  active: ['under_offer', 'withdrawn', 'expired'],
  under_offer: ['sold', 'active'],
  sold: [],
  expired: [],
  withdrawn: [],
};
const PROPERTY_TYPES = [
  'condo_unit',
  'house_and_lot',
  'lot_only',
  'townhouse',
  'commercial',
  'warehouse',
  'agricultural',
  'industrial',
] as const;
const OWNER_TYPES = ['developer', 'individual', 'company'] as const;

type CreateListingBody = {
  property_id?: string;
  listing_type?: string;
  price?: number;
  price_currency?: string;
  exclusivity?: string;
  authority_starts_at?: string;
  authority_expires_at?: string | null;
};

type CreatePropertyBody = {
  title?: string;
  type?: string;
  owner_type?: string;
  address?: string;
  city?: string;
  province?: string;
  floor_area_sqm?: number;
  lot_area_sqm?: number;
  bedrooms?: number;
  bathrooms?: number;
  parking_slots?: number;
  price?: number;
  price_currency?: string;
};

type UpdateListingStatusBody = {
  status?: string;
};

// tb-listings-create-001: the first brokerage-facing (requireAuth, not
// requireOperator) routes beyond workspace.ts's /me/... endpoints. Properties
// only had an admin-facing export path before this -- GET /properties is the
// smallest read an agent needs to pick one and create a listing against it.
export async function registerListingsRoutes(app: FastifyInstance) {
  app.get('/properties', { preHandler: requireAuth }, async (request, reply) => {
    const { data, error } = await supabaseAdmin
      .from('properties')
      .select('id, title, price, price_currency, status')
      .eq('tenant_id', request.user!.tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load properties' });
    }

    return { properties: data ?? [] };
  });

  // tb-listings-new-property-001: the only other way a property enters
  // residoro is Migration (operator-driven CSV import) -- this lets an
  // agent create one directly for the "I just got a new listing" moment.
  // owner_id is never accepted from the body -- always NULL on insert,
  // matching Migration's own existing behavior (no real Developer/Contact
  // FK target exists yet, cap-properties-001 Decision #2).
  app.post<{ Body: CreatePropertyBody }>('/properties', { preHandler: requireAuth }, async (request, reply) => {
    const {
      title,
      type,
      owner_type,
      address,
      city,
      province,
      floor_area_sqm,
      lot_area_sqm,
      bedrooms,
      bathrooms,
      parking_slots,
      price,
      price_currency,
    } = request.body ?? {};

    if (!title || !type || !owner_type) {
      return reply.status(400).send({ error: 'title, type, and owner_type are required' });
    }
    if (!PROPERTY_TYPES.includes(type as (typeof PROPERTY_TYPES)[number])) {
      return reply.status(400).send({ error: `type must be one of: ${PROPERTY_TYPES.join(', ')}` });
    }
    if (!OWNER_TYPES.includes(owner_type as (typeof OWNER_TYPES)[number])) {
      return reply.status(400).send({ error: `owner_type must be one of: ${OWNER_TYPES.join(', ')}` });
    }

    const numericFields = { floor_area_sqm, lot_area_sqm, bedrooms, bathrooms, parking_slots, price };
    for (const [field, value] of Object.entries(numericFields)) {
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
        return reply.status(400).send({ error: `${field} must be a non-negative number` });
      }
    }

    const { data: property, error: propertyError } = await supabaseAdmin
      .from('properties')
      .insert({
        tenant_id: request.user!.tenantId,
        created_by: request.user!.id,
        title,
        type,
        owner_type,
        owner_id: null,
        address,
        city,
        province,
        floor_area_sqm,
        lot_area_sqm,
        bedrooms,
        bathrooms,
        parking_slots,
        price,
        price_currency: price_currency ?? 'PHP',
      })
      .select('id, title, price, price_currency, status')
      .single();

    if (propertyError || !property) {
      request.log.error(propertyError);
      return reply.status(500).send({ error: 'Could not create the property' });
    }

    return reply.status(201).send(property);
  });

  // tb-listings-lifecycle-001: every listing a property has ever had, any
  // status, open or closed -- listings are never deleted, so this is the
  // "full listing history in chronological order" cap-listings-001
  // Milestone 3 names. Tenant-scoped the same way GET /listings is.
  app.get<{ Params: { id: string } }>(
    '/properties/:id/listings',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { data: property, error: propertyError } = await supabaseAdmin
        .from('properties')
        .select('id')
        .eq('id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .maybeSingle();

      if (propertyError) {
        request.log.error(propertyError);
        return reply.status(500).send({ error: 'Could not verify the property' });
      }
      if (!property) {
        return reply.status(404).send({ error: 'Property not found in your workspace' });
      }

      const { data, error } = await supabaseAdmin
        .from('listings')
        .select(
          'id, property_id, agent_id, listing_type, price, price_currency, exclusivity, authority_starts_at, authority_expires_at, status, created_at',
        )
        .eq('tenant_id', request.user!.tenantId)
        .eq('property_id', request.params.id)
        .order('created_at', { ascending: true });

      if (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not load the listing history' });
      }

      return { listings: data ?? [] };
    },
  );

  app.get('/listings', { preHandler: requireAuth }, async (request, reply) => {
    const { data, error } = await supabaseAdmin
      .from('listings')
      .select(
        'id, property_id, agent_id, listing_type, price, price_currency, exclusivity, authority_starts_at, authority_expires_at, status, created_at, properties(title)',
      )
      .eq('tenant_id', request.user!.tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load listings' });
    }

    const listings = (data as unknown as Array<{
      id: string;
      property_id: string;
      agent_id: string;
      listing_type: string;
      price: number;
      price_currency: string;
      exclusivity: string;
      authority_starts_at: string;
      authority_expires_at: string | null;
      status: string;
      created_at: string;
      properties: { title: string } | null;
    }>).map((l) => ({
      id: l.id,
      property_id: l.property_id,
      property_title: l.properties?.title ?? '',
      agent_id: l.agent_id,
      listing_type: l.listing_type,
      price: l.price,
      price_currency: l.price_currency,
      exclusivity: l.exclusivity,
      authority_starts_at: l.authority_starts_at,
      authority_expires_at: l.authority_expires_at,
      status: l.status,
      created_at: l.created_at,
    }));

    return { listings };
  });

  // Creates with status: 'draft' always -- moving to active/withdrawn is a
  // separate PATCH, matching the capability doc's own "starts as draft" line.
  // property_id is re-checked against the caller's own tenant (not just
  // trusted from the request body) even though the FK alone would let a
  // cross-tenant property_id reference succeed at the DB layer -- same
  // "never trust tenant scoping from the body" precedent as every other
  // tenant-scoped write route in this codebase.
  app.post<{ Body: CreateListingBody }>('/listings', { preHandler: requireAuth }, async (request, reply) => {
    const {
      property_id,
      listing_type,
      price,
      price_currency,
      exclusivity,
      authority_starts_at,
      authority_expires_at,
    } = request.body ?? {};

    if (!property_id || !listing_type || price === undefined || price === null) {
      return reply.status(400).send({ error: 'property_id, listing_type, and price are required' });
    }
    if (!LISTING_TYPES.includes(listing_type as (typeof LISTING_TYPES)[number])) {
      return reply.status(400).send({ error: "listing_type must be 'sale' or 'rent'" });
    }
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      return reply.status(400).send({ error: 'price must be a positive number' });
    }
    if (exclusivity !== undefined && !EXCLUSIVITY_VALUES.includes(exclusivity as (typeof EXCLUSIVITY_VALUES)[number])) {
      return reply.status(400).send({ error: "exclusivity must be 'exclusive' or 'open'" });
    }

    let startsAt: Date | undefined;
    if (authority_starts_at !== undefined) {
      startsAt = new Date(authority_starts_at);
      if (Number.isNaN(startsAt.getTime())) {
        return reply.status(400).send({ error: 'authority_starts_at must be a valid date' });
      }
    }

    let expiresAt: Date | null | undefined;
    if (authority_expires_at !== undefined && authority_expires_at !== null) {
      expiresAt = new Date(authority_expires_at);
      if (Number.isNaN(expiresAt.getTime())) {
        return reply.status(400).send({ error: 'authority_expires_at must be a valid date' });
      }
      if (startsAt && expiresAt <= startsAt) {
        return reply.status(400).send({ error: 'authority_expires_at must be after authority_starts_at' });
      }
    } else if (authority_expires_at === null) {
      expiresAt = null;
    }

    const { data: property, error: propertyError } = await supabaseAdmin
      .from('properties')
      .select('id')
      .eq('id', property_id)
      .eq('tenant_id', request.user!.tenantId)
      .maybeSingle();

    if (propertyError) {
      request.log.error(propertyError);
      return reply.status(500).send({ error: 'Could not verify the property' });
    }
    if (!property) {
      return reply.status(404).send({ error: 'Property not found in your workspace' });
    }

    const { data: listing, error: listingError } = await supabaseAdmin
      .from('listings')
      .insert({
        tenant_id: request.user!.tenantId,
        property_id,
        agent_id: request.user!.id,
        listing_type,
        price,
        price_currency: price_currency ?? 'PHP',
        exclusivity: exclusivity ?? 'open',
        ...(startsAt ? { authority_starts_at: startsAt.toISOString() } : {}),
        ...(expiresAt !== undefined ? { authority_expires_at: expiresAt?.toISOString() ?? null } : {}),
      })
      .select(
        'id, property_id, listing_type, price, price_currency, exclusivity, authority_starts_at, authority_expires_at, status',
      )
      .single();

    if (listingError || !listing) {
      request.log.error(listingError);
      return reply.status(500).send({ error: 'Could not create the listing' });
    }

    return reply.status(201).send(listing);
  });

  app.patch<{ Params: { id: string }; Body: UpdateListingStatusBody }>(
    '/listings/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { status } = request.body ?? {};

      if (!status || !STATUSES.includes(status as (typeof STATUSES)[number])) {
        return reply.status(400).send({ error: `status must be one of: ${STATUSES.join(', ')}` });
      }

      const { data: current, error: currentError } = await supabaseAdmin
        .from('listings')
        .select('id, property_id, status')
        .eq('id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .maybeSingle();

      if (currentError) {
        request.log.error(currentError);
        return reply.status(500).send({ error: 'Could not load the listing' });
      }
      if (!current) {
        return reply.status(404).send({ error: 'Listing not found in your workspace' });
      }

      const legalNext = STATUS_TRANSITIONS[current.status] ?? [];
      if (!legalNext.includes(status)) {
        return reply
          .status(400)
          .send({ error: `Cannot move a listing from '${current.status}' to '${status}'` });
      }

      const { data, error } = await supabaseAdmin
        .from('listings')
        .update({ status })
        .eq('id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .select('id, property_id, status')
        .maybeSingle();

      if (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not update the listing' });
      }
      if (!data) {
        return reply.status(404).send({ error: 'Listing not found in your workspace' });
      }

      // tb-listings-authority-001: activating a listing on a property that
      // already has another active exclusive listing still succeeds -- soft
      // warning only, never a block, per cap-listings-001 Decision #2.
      if (status === 'active') {
        const { data: conflicting, error: conflictError } = await supabaseAdmin
          .from('listings')
          .select('id')
          .eq('tenant_id', request.user!.tenantId)
          .eq('property_id', data.property_id)
          .eq('status', 'active')
          .eq('exclusivity', 'exclusive')
          .neq('id', data.id)
          .limit(1)
          .maybeSingle();

        if (conflictError) {
          request.log.error(conflictError);
        } else if (conflicting) {
          return { ...data, warning: 'This property already has an active exclusive listing.' };
        }
      }

      return data;
    },
  );
}
