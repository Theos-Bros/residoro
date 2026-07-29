import type { FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAuth, getScopedClient } from '../lib/auth.js';

const LISTING_TYPES = ['sale', 'rent'] as const;
const STATUSES = [
  'draft',
  'active',
  'under_offer',
  'sold',
  'expired',
  'withdrawn',
  'inactive',
] as const;
const EXCLUSIVITY_VALUES = ['exclusive', 'open'] as const;

// tb-listings-lifecycle-001: the real state machine cap-listings-001
// Milestone 3 names. draft/active/withdrawn-only (tb-listings-create-001)
// allowed any status write; this closes that gap. sold/withdrawn are
// terminal -- no further transitions once a listing lands there. Reassigning
// a listing to a new agent is NOT a transition here: it's withdrawing this
// row (active -> withdrawn) and POSTing a brand-new listing on the same
// property, per cap-listings-001's "closing one and creating another"
// framing.
//
// UX follow-up (same session): 'expired' is reachable only via
// autoExpireLapsedListings below, never via a client-requested PATCH --
// that's why it's absent from active/under_offer's arrays even though the
// system itself still writes it. It's also no longer terminal: 'active' is
// a legal move back out of it, but only actually escapes expiry if the PATCH
// also supplies a new (future) authority_expires_at -- renewing without
// fixing the date just gets auto-re-expired the next time listings are read.
//
// tb-listings-status-ladder-001: 'inactive' is a new pausable state reachable
// from 'active' (active <-> inactive), additive alongside 'draft' -- not a
// replacement for it. 'sold' was already terminal before this change; no
// change to its transitions.
const STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ['active', 'withdrawn'],
  active: ['under_offer', 'inactive', 'withdrawn'],
  inactive: ['active', 'withdrawn'],
  under_offer: ['sold', 'active'],
  sold: [],
  expired: ['active', 'withdrawn'],
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
const VERIFICATION_STATUSES = ['unverified', 'pending', 'verified', 'flagged'] as const;
const PROPERTY_STATUSES = ['available', 'reserved', 'sold', 'off_market'] as const;

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
  project_id?: string;
  owner_id?: string;
};

type UpdateListingStatusBody = {
  status?: string;
  authority_starts_at?: string;
  authority_expires_at?: string | null;
  buyer_contact_id?: string;
  // tb-listings-detail-edit-modal-001: field edits on an existing listing --
  // independent of a status transition, so a PATCH can carry either or both.
  listing_type?: string;
  price?: number;
  exclusivity?: string;
};

type UpdatePropertyVerificationBody = {
  verification_status?: string;
};

// tb-properties-edit-001: every field here has been create-time-only via
// POST /properties until now. owner_type/owner_id are admin-only (see the
// route below) -- everything else is open to any authenticated tenant user,
// matching POST /properties' own lack of a role check.
type UpdatePropertyBody = {
  title?: string;
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
  status?: string;
  owner_type?: string;
  owner_id?: string | null;
};

// UX follow-up: "the expiry of the authority to sell should be automatic,
// it shouldn't be manual to mark it as expired" -- lazily swept on every
// read/write instead of a cron job. Only active/under_offer listings with a
// past authority_expires_at are affected; draft listings aren't yet
// marketing the property, so an unactivated draft's dates don't matter until
// it's activated (at which point the very next read catches it).
async function autoExpireLapsedListings(supabase: SupabaseClient, tenantId: string) {
  const { error } = await supabase
    .from('listings')
    .update({ status: 'expired' })
    .eq('tenant_id', tenantId)
    .in('status', ['active', 'under_offer'])
    .not('authority_expires_at', 'is', null)
    .lt('authority_expires_at', new Date().toISOString());

  if (error) throw error;
}

function parseAuthorityDates(
  authorityStartsAt: string | undefined,
  authorityExpiresAt: string | null | undefined,
): { error: string } | { startsAt?: Date; expiresAt?: Date | null } {
  let startsAt: Date | undefined;
  if (authorityStartsAt !== undefined) {
    startsAt = new Date(authorityStartsAt);
    if (Number.isNaN(startsAt.getTime())) {
      return { error: 'authority_starts_at must be a valid date' };
    }
  }

  let expiresAt: Date | null | undefined;
  if (authorityExpiresAt !== undefined && authorityExpiresAt !== null) {
    expiresAt = new Date(authorityExpiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      return { error: 'authority_expires_at must be a valid date' };
    }
    if (startsAt && expiresAt <= startsAt) {
      return { error: 'authority_expires_at must be after authority_starts_at' };
    }
  } else if (authorityExpiresAt === null) {
    expiresAt = null;
  }

  return { startsAt, expiresAt };
}

// tb-properties-media-external-links-001: a cover-link lookup for the list,
// batched in one query. property_media rows are now pasted external links,
// not Storage-hosted files, so no signed-URL step is needed -- the stored
// external_url is returned as-is. Returns undefined for any property with no
// cover row -- callers render a placeholder/no-link-out affordance then, not
// an error.
async function coverPhotoUrlsByProperty(
  supabase: SupabaseClient,
  propertyIds: string[],
): Promise<Map<string, string>> {
  if (propertyIds.length === 0) return new Map();

  const { data: covers, error } = await supabase
    .from('property_media')
    .select('property_id, external_url')
    .in('property_id', propertyIds)
    .eq('is_cover', true);

  if (error || !covers) return new Map();

  return new Map(covers.map((cover) => [cover.property_id, cover.external_url] as const));
}

// tb-listings-create-001: the first brokerage-facing (requireAuth, not
// requireOperator) routes beyond workspace.ts's /me/... endpoints. Properties
// only had an admin-facing export path before this -- GET /properties is the
// smallest read an agent needs to pick one and create a listing against it.
export async function registerListingsRoutes(app: FastifyInstance) {
  app.get('/properties', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const { data, error } = await supabase
      .from('properties')
      .select('id, title, price, price_currency, status, verification_status')
      .eq('tenant_id', request.user!.tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load properties' });
    }

    const properties = data ?? [];
    const coverUrls = await coverPhotoUrlsByProperty(supabase, properties.map((p) => p.id));

    return {
      properties: properties.map((property) => ({
        ...property,
        cover_photo_url: coverUrls.get(property.id),
      })),
    };
  });

  // tb-listings-new-property-001: the only other way a property enters
  // residoro is Migration (operator-driven CSV import) -- this lets an
  // agent create one directly for the "I just got a new listing" moment.
  //
  // tb-properties-project-001: project_id is only accepted when
  // owner_type = 'developer' -- resale properties (individual/company) never
  // get a project_id, enforced here server-side, not just hidden in the UI.
  // A developer-owned property may still omit project_id (standalone
  // developer inventory not yet assigned to a project); if given, it's
  // re-verified against the caller's own tenant, same "never trust tenant
  // scoping from the body" precedent as every other write route here.
  //
  // tb-properties-owner-linking-001: owner_id is now optionally accepted and
  // validated against the table matching owner_type -- `developers` for
  // 'developer', `contacts` for 'individual'/'company' (cap-properties-001's
  // own Notes named Contact as the closest candidate for that case). Omitting
  // it still inserts null, unchanged from before this tracer bullet.
  app.post<{ Body: CreatePropertyBody }>('/properties', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
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
      project_id,
      owner_id,
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
    if (project_id && owner_type !== 'developer') {
      return reply.status(400).send({ error: 'project_id can only be set when owner_type is developer' });
    }

    const numericFields = { floor_area_sqm, lot_area_sqm, bedrooms, bathrooms, parking_slots, price };
    for (const [field, value] of Object.entries(numericFields)) {
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
        return reply.status(400).send({ error: `${field} must be a non-negative number` });
      }
    }

    if (project_id) {
      const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('id')
        .eq('id', project_id)
        .eq('tenant_id', request.user!.tenantId)
        .maybeSingle();

      if (projectError) {
        request.log.error(projectError);
        return reply.status(500).send({ error: 'Could not verify the project' });
      }
      if (!project) {
        return reply.status(404).send({ error: 'Project not found in your workspace' });
      }
    }

    if (owner_id) {
      // tb-crm-developer-consolidation-001: developers was folded into contacts
      // via is_company -- every owner_type now resolves through contacts.
      const { data: owner, error: ownerError } = await supabase
        .from('contacts')
        .select('id')
        .eq('id', owner_id)
        .eq('tenant_id', request.user!.tenantId)
        .maybeSingle();

      if (ownerError) {
        request.log.error(ownerError);
        return reply.status(500).send({ error: 'Could not verify the owner' });
      }
      if (!owner) {
        return reply.status(404).send({ error: 'Owner not found in your workspace' });
      }
    }

    const { data: property, error: propertyError } = await supabase
      .from('properties')
      .insert({
        tenant_id: request.user!.tenantId,
        created_by: request.user!.id,
        title,
        type,
        owner_type,
        owner_id: owner_id ?? null,
        project_id: project_id ?? null,
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

  // tb-properties-verification-001: the verification_status column has
  // existed since mil-platform-foundation-001's migration but nothing wrote
  // it until now. Admin-only in code, not RLS -- properties_update_tenant
  // allows any tenant member's UPDATE; this route's own role check is the
  // only thing gating verification_status specifically. This is the first
  // route in the codebase to check request.user.role directly. (Prior to
  // tb-platform-rls-scoped-client-001, every properties route ran on
  // supabaseAdmin, so properties_delete_admin was never actually enforced by
  // Postgres for any route -- now that this route uses the scoped client,
  // RLS is live underneath it too, not just this app-level check.)
  app.patch<{ Params: { id: string }; Body: UpdatePropertyVerificationBody }>(
    '/properties/:id/verification',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (request.user!.role !== 'admin') {
        return reply.status(403).send({ error: 'Only an admin can change verification status' });
      }

      const supabase = getScopedClient(request);
      const { verification_status } = request.body ?? {};

      if (!verification_status || !VERIFICATION_STATUSES.includes(verification_status as (typeof VERIFICATION_STATUSES)[number])) {
        return reply
          .status(400)
          .send({ error: `verification_status must be one of: ${VERIFICATION_STATUSES.join(', ')}` });
      }

      const { data: property, error } = await supabase
        .from('properties')
        .update({ verification_status })
        .eq('id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .select('id, verification_status')
        .single();

      if (error || !property) {
        request.log.error(error);
        return reply.status(404).send({ error: 'Property not found' });
      }

      return property;
    },
  );

  // tb-properties-edit-001: the general property-edit gap named across
  // tb-properties-project-001, tb-properties-bulk-units-001, and
  // tb-properties-owner-linking-001's own "What Happens Next" sections --
  // every field here except verification_status (its own route above) and
  // project_id/unit_number/type (still create-time-only, see semantic_scope)
  // was previously only writable via POST /properties. Reuses POST's exact
  // numeric-field validation and owner-table lookup rather than duplicating
  // slightly-different rules. owner_type/owner_id are gated admin-only and
  // must be given together (a partial ownership change could leave owner_id
  // pointing at the wrong table) -- owner_id may be explicitly null to clear
  // ownership.
  app.patch<{ Params: { id: string }; Body: UpdatePropertyBody }>(
    '/properties/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const supabase = getScopedClient(request);
      const {
        title,
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
        status,
        owner_type,
        owner_id,
      } = request.body ?? {};

      const updateFields: Record<string, unknown> = {};

      if (title !== undefined) {
        if (!title.trim()) {
          return reply.status(400).send({ error: 'title cannot be empty' });
        }
        updateFields.title = title;
      }
      if (address !== undefined) updateFields.address = address;
      if (city !== undefined) updateFields.city = city;
      if (province !== undefined) updateFields.province = province;
      if (price_currency !== undefined) updateFields.price_currency = price_currency;

      const numericFields = { floor_area_sqm, lot_area_sqm, bedrooms, bathrooms, parking_slots, price };
      for (const [field, value] of Object.entries(numericFields)) {
        if (value !== undefined) {
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
            return reply.status(400).send({ error: `${field} must be a non-negative number` });
          }
          updateFields[field] = value;
        }
      }

      if (status !== undefined) {
        if (!PROPERTY_STATUSES.includes(status as (typeof PROPERTY_STATUSES)[number])) {
          return reply.status(400).send({ error: `status must be one of: ${PROPERTY_STATUSES.join(', ')}` });
        }
        updateFields.status = status;
      }

      if (owner_type !== undefined || owner_id !== undefined) {
        if (request.user!.role !== 'admin') {
          return reply.status(403).send({ error: 'Only an admin can change property ownership' });
        }
        if (owner_type === undefined || owner_id === undefined) {
          return reply.status(400).send({ error: 'owner_type and owner_id must be provided together' });
        }
        if (!OWNER_TYPES.includes(owner_type as (typeof OWNER_TYPES)[number])) {
          return reply.status(400).send({ error: `owner_type must be one of: ${OWNER_TYPES.join(', ')}` });
        }
        if (owner_id !== null) {
          // tb-crm-developer-consolidation-001: developers was folded into
          // contacts via is_company -- every owner_type now resolves through contacts.
          const { data: owner, error: ownerError } = await supabase
            .from('contacts')
            .select('id')
            .eq('id', owner_id)
            .eq('tenant_id', request.user!.tenantId)
            .maybeSingle();

          if (ownerError) {
            request.log.error(ownerError);
            return reply.status(500).send({ error: 'Could not verify the owner' });
          }
          if (!owner) {
            return reply.status(404).send({ error: 'Owner not found in your workspace' });
          }
        }
        updateFields.owner_type = owner_type;
        updateFields.owner_id = owner_id;
      }

      if (Object.keys(updateFields).length === 0) {
        return reply.status(400).send({ error: 'No editable fields were provided' });
      }

      const { data: property, error } = await supabase
        .from('properties')
        .update(updateFields)
        .eq('id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .select('id, title, price, price_currency, status, owner_type, owner_id')
        .single();

      if (error || !property) {
        request.log.error(error);
        return reply.status(404).send({ error: 'Property not found' });
      }

      return property;
    },
  );

  // tb-listings-lifecycle-001: every listing a property has ever had, any
  // status, open or closed -- listings are never deleted, so this is the
  // "full listing history in chronological order" cap-listings-001
  // Milestone 3 names. Tenant-scoped the same way GET /listings is.
  app.get<{ Params: { id: string } }>(
    '/properties/:id/listings',
    { preHandler: requireAuth },
    async (request, reply) => {
      const supabase = getScopedClient(request);
      try {
        await autoExpireLapsedListings(supabase, request.user!.tenantId);
      } catch (err) {
        request.log.error(err);
        return reply.status(500).send({ error: 'Could not refresh listing statuses' });
      }

      const { data: property, error: propertyError } = await supabase
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

      const { data, error } = await supabase
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
    const supabase = getScopedClient(request);
    try {
      await autoExpireLapsedListings(supabase, request.user!.tenantId);
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ error: 'Could not refresh listing statuses' });
    }

    const { data, error } = await supabase
      .from('listings')
      .select(
        'id, property_id, agent_id, listing_type, price, price_currency, exclusivity, authority_starts_at, authority_expires_at, status, created_at, buyer_contact_id, properties(title), contacts(name)',
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
      buyer_contact_id: string | null;
      properties: { title: string } | null;
      contacts: { name: string } | null;
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
      buyer_contact_id: l.buyer_contact_id,
      buyer_name: l.contacts?.name ?? null,
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
    const supabase = getScopedClient(request);
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

    const parsedDates = parseAuthorityDates(authority_starts_at, authority_expires_at);
    if ('error' in parsedDates) {
      return reply.status(400).send({ error: parsedDates.error });
    }
    const { startsAt, expiresAt } = parsedDates;

    const { data: property, error: propertyError } = await supabase
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

    const { data: listing, error: listingError } = await supabase
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
      const supabase = getScopedClient(request);
      try {
        await autoExpireLapsedListings(supabase, request.user!.tenantId);
      } catch (err) {
        request.log.error(err);
        return reply.status(500).send({ error: 'Could not refresh listing statuses' });
      }

      const {
        status,
        authority_starts_at,
        authority_expires_at,
        buyer_contact_id,
        listing_type,
        price,
        exclusivity,
      } = request.body ?? {};

      // tb-listings-detail-edit-modal-001: status is no longer required on
      // every PATCH -- a request can carry a pure field edit
      // (listing_type/price/exclusivity), a status transition, or both.
      if (
        status === undefined &&
        listing_type === undefined &&
        price === undefined &&
        exclusivity === undefined
      ) {
        return reply.status(400).send({
          error: 'At least one of status, listing_type, price, or exclusivity is required',
        });
      }

      if (status !== undefined && !STATUSES.includes(status as (typeof STATUSES)[number])) {
        return reply.status(400).send({ error: `status must be one of: ${STATUSES.join(', ')}` });
      }
      if (listing_type !== undefined && !LISTING_TYPES.includes(listing_type as (typeof LISTING_TYPES)[number])) {
        return reply.status(400).send({ error: "listing_type must be 'sale' or 'rent'" });
      }
      if (price !== undefined && (typeof price !== 'number' || !Number.isFinite(price) || price <= 0)) {
        return reply.status(400).send({ error: 'price must be a positive number' });
      }
      if (exclusivity !== undefined && !EXCLUSIVITY_VALUES.includes(exclusivity as (typeof EXCLUSIVITY_VALUES)[number])) {
        return reply.status(400).send({ error: "exclusivity must be 'exclusive' or 'open'" });
      }

      // tb-crm-buyer-001: sold is terminal (STATUS_TRANSITIONS.sold = []), so this
      // is the single well-defined point buyer_contact_id can ever be set.
      if (status === 'sold' && !buyer_contact_id) {
        return reply.status(400).send({ error: 'buyer_contact_id is required when marking a listing sold' });
      }
      if (status !== 'sold' && buyer_contact_id) {
        return reply.status(400).send({ error: 'buyer_contact_id can only be set when marking a listing sold' });
      }

      // UX follow-up: lets a renewal (expired -> active) update the
      // authority dates in the same request that reactivates the listing --
      // "secure another ATS/ATL" from the warning badge. Optional for every
      // other transition; unset fields are left alone.
      const parsedDates = parseAuthorityDates(authority_starts_at, authority_expires_at);
      if ('error' in parsedDates) {
        return reply.status(400).send({ error: parsedDates.error });
      }
      const { startsAt, expiresAt } = parsedDates;

      const { data: current, error: currentError } = await supabase
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

      if (status !== undefined) {
        const legalNext = STATUS_TRANSITIONS[current.status] ?? [];
        if (!legalNext.includes(status)) {
          return reply
            .status(400)
            .send({ error: `Cannot move a listing from '${current.status}' to '${status}'` });
        }
      }

      if (status === 'sold') {
        const { data: buyer, error: buyerError } = await supabase
          .from('contacts')
          .select('id')
          .eq('id', buyer_contact_id)
          .eq('tenant_id', request.user!.tenantId)
          .maybeSingle();

        if (buyerError) {
          request.log.error(buyerError);
          return reply.status(500).send({ error: 'Could not verify the buyer' });
        }
        if (!buyer) {
          return reply.status(404).send({ error: 'Buyer not found in your workspace' });
        }
      }

      // tb-listings-authority-001 / tb-listings-exclusivity-hardblock-001:
      // checked BEFORE the update below (not after, as the original
      // soft-warning-only version did) so a hard-blocked workspace never
      // persists the conflicting activation at all -- no write-then-rollback.
      let conflictWarning: string | undefined;
      if (status === 'active') {
        const { data: conflicting, error: conflictError } = await supabase
          .from('listings')
          .select('id')
          .eq('tenant_id', request.user!.tenantId)
          .eq('property_id', current.property_id)
          .eq('status', 'active')
          .eq('exclusivity', 'exclusive')
          .neq('id', current.id)
          .limit(1)
          .maybeSingle();

        if (conflictError) {
          request.log.error(conflictError);
        } else if (conflicting) {
          const { data: workspace, error: workspaceError } = await supabase
            .from('workspaces')
            .select('exclusivity_hard_block')
            .eq('id', request.user!.tenantId)
            .single();

          if (workspaceError) {
            request.log.error(workspaceError);
          } else if (workspace.exclusivity_hard_block) {
            return reply
              .status(409)
              .send({ error: 'This property already has an active exclusive listing.' });
          } else {
            conflictWarning = 'This property already has an active exclusive listing.';
          }
        }
      }

      const { data, error } = await supabase
        .from('listings')
        .update({
          ...(status !== undefined ? { status } : {}),
          ...(startsAt ? { authority_starts_at: startsAt.toISOString() } : {}),
          ...(expiresAt !== undefined ? { authority_expires_at: expiresAt?.toISOString() ?? null } : {}),
          ...(status === 'sold' ? { buyer_contact_id } : {}),
          ...(listing_type !== undefined ? { listing_type } : {}),
          ...(price !== undefined ? { price } : {}),
          ...(exclusivity !== undefined ? { exclusivity } : {}),
        })
        .eq('id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .select('id, property_id, status, buyer_contact_id, listing_type, price, exclusivity')
        .maybeSingle();

      if (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not update the listing' });
      }
      if (!data) {
        return reply.status(404).send({ error: 'Listing not found in your workspace' });
      }

      return conflictWarning ? { ...data, warning: conflictWarning } : data;
    },
  );
}
