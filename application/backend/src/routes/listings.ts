import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth.js';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

const LISTING_TYPES = ['sale', 'rent'] as const;
const STATUSES = ['active', 'withdrawn'] as const;

type CreateListingBody = {
  property_id?: string;
  listing_type?: string;
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

  app.get('/listings', { preHandler: requireAuth }, async (request, reply) => {
    const { data, error } = await supabaseAdmin
      .from('listings')
      .select('id, property_id, agent_id, listing_type, price, price_currency, status, created_at, properties(title)')
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
    const { property_id, listing_type, price, price_currency } = request.body ?? {};

    if (!property_id || !listing_type || price === undefined || price === null) {
      return reply.status(400).send({ error: 'property_id, listing_type, and price are required' });
    }
    if (!LISTING_TYPES.includes(listing_type as (typeof LISTING_TYPES)[number])) {
      return reply.status(400).send({ error: "listing_type must be 'sale' or 'rent'" });
    }
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      return reply.status(400).send({ error: 'price must be a positive number' });
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
      })
      .select('id, property_id, listing_type, price, price_currency, status')
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
        return reply.status(400).send({ error: "status must be 'active' or 'withdrawn'" });
      }

      const { data, error } = await supabaseAdmin
        .from('listings')
        .update({ status })
        .eq('id', request.params.id)
        .eq('tenant_id', request.user!.tenantId)
        .select('id, status')
        .maybeSingle();

      if (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Could not update the listing' });
      }
      if (!data) {
        return reply.status(404).send({ error: 'Listing not found in your workspace' });
      }

      return data;
    },
  );
}
