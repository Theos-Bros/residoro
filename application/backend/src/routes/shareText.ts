import type { FastifyInstance } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAuth, getScopedClient } from '../lib/auth.js';

type Audience = 'public' | 'co_broker' | 'internal';
const AUDIENCES: Audience[] = ['public', 'co_broker', 'internal'];

type ShareTemplatesBody = {
  public_share_template?: string;
  co_broker_share_template?: string;
};

type PropertyRow = {
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
  owner_type: string;
  owner_id: string;
};

type ListingRow = {
  id: string;
  property_id: string;
  listing_type: string;
  price: number;
  price_currency: string;
  exclusivity: string;
  status: string;
  authority_starts_at: string;
  authority_expires_at: string | null;
  commission_note: string | null;
};

// {{merge_field}} substitution against a flat field map -- unmatched tokens
// resolve to an empty string rather than leaving the literal token behind,
// so a brokerage template referencing a field this listing doesn't have
// (e.g. bedrooms on a lot_only property) degrades gracefully.
function mergeTemplate(template: string, fields: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => fields[key] ?? '');
}

function commonFields(property: PropertyRow, listing: ListingRow): Record<string, string> {
  return {
    title: property.title,
    type: property.type,
    address: property.address ?? '',
    city: property.city ?? '',
    province: property.province ?? '',
    price: listing.price.toLocaleString(),
    price_currency: listing.price_currency,
    listing_type: listing.listing_type,
    bedrooms: property.bedrooms?.toString() ?? '',
    bathrooms: property.bathrooms?.toString() ?? '',
    floor_area_sqm: property.floor_area_sqm?.toString() ?? '',
    lot_area_sqm: property.lot_area_sqm?.toString() ?? '',
    parking_slots: property.parking_slots?.toString() ?? '',
  };
}

// Internal-only: resolves properties.owner_type/owner_id to a display name +
// contact string, per cap-properties-001's polymorphic ownership model.
async function resolveOwner(
  supabase: SupabaseClient,
  ownerType: string,
  ownerId: string,
): Promise<{ owner_name: string; owner_contact: string }> {
  if (ownerType === 'developer') {
    const { data } = await supabase.from('developers').select('name, contact_info').eq('id', ownerId).maybeSingle();
    if (!data) return { owner_name: '', owner_contact: '' };
    const info = (data.contact_info ?? {}) as Record<string, unknown>;
    const contact = Object.entries(info)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');
    return { owner_name: data.name, owner_contact: contact };
  }

  const { data } = await supabase.from('contacts').select('name, email, phone, company').eq('id', ownerId).maybeSingle();
  if (!data) return { owner_name: '', owner_contact: '' };
  const contact = [data.phone, data.email, data.company].filter(Boolean).join(', ');
  return { owner_name: data.name, owner_contact: contact };
}

async function loadListingAndProperty(supabase: SupabaseClient, tenantId: string, listingId: string) {
  const { data: listing } = await supabase
    .from('listings')
    .select(
      'id, property_id, listing_type, price, price_currency, exclusivity, status, authority_starts_at, authority_expires_at, commission_note',
    )
    .eq('id', listingId)
    .eq('tenant_id', tenantId)
    .maybeSingle<ListingRow>();
  if (!listing) return null;

  const { data: property } = await supabase
    .from('properties')
    .select(
      'title, type, address, city, province, floor_area_sqm, lot_area_sqm, bedrooms, bathrooms, parking_slots, owner_type, owner_id',
    )
    .eq('id', listing.property_id)
    .eq('tenant_id', tenantId)
    .maybeSingle<PropertyRow>();
  if (!property) return null;

  return { listing, property };
}

export async function registerShareTextRoutes(app: FastifyInstance) {
  app.get('/settings/share-templates', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const { data, error } = await supabase
      .from('workspaces')
      .select('public_share_template, co_broker_share_template')
      .eq('id', request.user!.tenantId)
      .single();

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load sharing templates' });
    }
    return data;
  });

  // RLS (workspaces_update_admin) already blocks a non-admin's update at the
  // database layer -- this app-level check exists only to return a clean 403
  // instead of a generic Postgres/RLS failure, matching
  // tb-properties-verification-001's precedent.
  app.patch<{ Body: ShareTemplatesBody }>('/settings/share-templates', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user!.role !== 'admin') {
      return reply.status(403).send({ error: 'Only an admin can edit sharing templates' });
    }

    const { public_share_template, co_broker_share_template } = request.body ?? {};
    if (public_share_template === undefined && co_broker_share_template === undefined) {
      return reply.status(400).send({ error: 'public_share_template or co_broker_share_template is required' });
    }

    const supabase = getScopedClient(request);
    const { data, error } = await supabase
      .from('workspaces')
      .update({
        ...(public_share_template !== undefined && { public_share_template }),
        ...(co_broker_share_template !== undefined && { co_broker_share_template }),
      })
      .eq('id', request.user!.tenantId)
      .select('public_share_template, co_broker_share_template')
      .single();

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not save sharing templates' });
    }
    return data;
  });

  app.get<{ Params: { id: string }; Querystring: { audience?: string } }>(
    '/listings/:id/share-text',
    { preHandler: requireAuth },
    async (request, reply) => {
      const audience = request.query.audience as Audience | undefined;
      if (!audience || !AUDIENCES.includes(audience)) {
        return reply.status(400).send({ error: `audience must be one of: ${AUDIENCES.join(', ')}` });
      }

      const supabase = getScopedClient(request);
      const loaded = await loadListingAndProperty(supabase, request.user!.tenantId, request.params.id);
      if (!loaded) {
        return reply.status(404).send({ error: 'Listing not found in your workspace' });
      }
      const { listing, property } = loaded;
      const fields = commonFields(property, listing);

      if (audience === 'internal') {
        const { owner_name, owner_contact } = await resolveOwner(supabase, property.owner_type, property.owner_id);
        const lines = [
          `${fields.title} (${fields.type})`,
          `${fields.address} ${fields.city} ${fields.province}`.trim(),
          `${fields.listing_type} — ${fields.price_currency} ${fields.price}`,
          `Beds ${fields.bedrooms || '-'} / Baths ${fields.bathrooms || '-'} / Floor ${fields.floor_area_sqm || '-'}sqm / Lot ${fields.lot_area_sqm || '-'}sqm / Parking ${fields.parking_slots || '-'}`,
          `Exclusivity: ${listing.exclusivity}`,
          `Status: ${listing.status}`,
          `Authority: ${listing.authority_starts_at} – ${listing.authority_expires_at ?? 'open-ended'}`,
          `Owner: ${owner_name} (${owner_contact || 'no contact on file'})`,
          `Commission note: ${listing.commission_note ?? '(none)'}`,
        ];
        return { text: lines.join('\n') };
      }

      const { data: workspace } = await supabase
        .from('workspaces')
        .select('public_share_template, co_broker_share_template')
        .eq('id', request.user!.tenantId)
        .single();

      if (audience === 'co_broker') {
        const template = workspace?.co_broker_share_template ?? '';
        return { text: mergeTemplate(template, { ...fields, commission_note: listing.commission_note ?? '' }) };
      }

      const template = workspace?.public_share_template ?? '';
      return { text: mergeTemplate(template, fields) };
    },
  );
}
