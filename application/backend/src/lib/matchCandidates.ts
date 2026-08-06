import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from './supabaseAdmin.js';

// tb-buyer-leads-match-itinerary-001: shared candidate resolution +
// eligibility validation for all three actions (log match, copy as text,
// generate itinerary) on a set of matched Search-page results. A candidate
// is EITHER a listing_id (this tenant's own active listing, or the
// source_listing_id of an active docket shared with the caller -- same
// "never trust the client" re-verification buyerRequirements.ts's
// options-sent handler already does) OR a property_id (a project-linked,
// not-yet-listed unit owned by this tenant, per
// tb-buyer-leads-matching-project-units-001's MatchResult shape). This file
// intentionally duplicates rather than imports options-sent's inline
// validation -- semantic_scope for this tracer bullet explicitly says not to
// couple to unrelated stage-transition semantics, and options-sent's
// validation logic lives inline in a handler, not as an exported helper;
// re-deriving a parallel (not shared) implementation here is the lower-risk
// choice, since editing buyerRequirements.ts to export something is more
// likely to regress that route than writing new code next to it.

export type MatchItemInput = { listing_id?: unknown; property_id?: unknown };

export type ResolvedMatchItem = {
  listing_id: string | null;
  property_id: string | null;
  source: 'inventory' | 'docket' | 'project_unit';
  shared_by_handle: string | null;
  fields: {
    title: string;
    type: string;
    address: string;
    city: string;
    province: string;
    price: number | null;
    price_currency: string;
    bedrooms: number | null;
    bathrooms: number | null;
    floor_area_sqm: number | null;
    lot_area_sqm: number | null;
    parking_slots: number | null;
  };
};

type ListingJoinRow = {
  id: string;
  price: number | null;
  price_currency: string;
  properties: {
    title: string | null;
    type: string | null;
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

type PropertyRow = {
  id: string;
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
  price: number | null;
  price_currency: string;
  projects: { name: string | null } | null;
};

function fieldsFromListing(row: ListingJoinRow): ResolvedMatchItem['fields'] {
  return {
    title: row.properties?.title ?? '(untitled)',
    type: row.properties?.type ?? '',
    address: row.properties?.address ?? '',
    city: row.properties?.city ?? '',
    province: row.properties?.province ?? '',
    price: row.price,
    price_currency: row.price_currency,
    bedrooms: row.properties?.bedrooms ?? null,
    bathrooms: row.properties?.bathrooms ?? null,
    floor_area_sqm: row.properties?.floor_area_sqm ?? null,
    lot_area_sqm: row.properties?.lot_area_sqm ?? null,
    parking_slots: row.properties?.parking_slots ?? null,
  };
}

function fieldsFromProperty(row: PropertyRow): ResolvedMatchItem['fields'] {
  return {
    title: `${row.title} (${row.projects?.name ?? 'Project'})`,
    type: row.type,
    address: row.address ?? '',
    city: row.city ?? '',
    province: row.province ?? '',
    price: row.price,
    price_currency: row.price_currency,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    floor_area_sqm: row.floor_area_sqm,
    lot_area_sqm: row.lot_area_sqm,
    parking_slots: row.parking_slots,
  };
}

export type ResolveResult = { ok: true; items: ResolvedMatchItem[] } | { ok: false; error: string };

export async function resolveAndValidateMatchItems(
  supabase: SupabaseClient,
  tenantId: string,
  callerId: string,
  rawItems: unknown,
): Promise<ResolveResult> {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { ok: false, error: 'items is required and must be a non-empty array' };
  }

  const listingIds: string[] = [];
  const propertyIds: string[] = [];
  const order: Array<{ kind: 'listing' | 'property'; id: string }> = [];

  for (const raw of rawItems as MatchItemInput[]) {
    const listingId = typeof raw?.listing_id === 'string' ? raw.listing_id : undefined;
    const propertyId = typeof raw?.property_id === 'string' ? raw.property_id : undefined;
    if ((listingId && propertyId) || (!listingId && !propertyId)) {
      return { ok: false, error: 'Each item must have exactly one of listing_id or property_id' };
    }
    if (listingId) {
      listingIds.push(listingId);
      order.push({ kind: 'listing', id: listingId });
    } else if (propertyId) {
      propertyIds.push(propertyId);
      order.push({ kind: 'property', id: propertyId });
    }
  }

  const resolvedListings = new Map<string, ResolvedMatchItem>();
  const resolvedProperties = new Map<string, ResolvedMatchItem>();

  if (listingIds.length > 0) {
    const { data: ownRows, error: ownError } = await supabase
      .from('listings')
      .select('id, price, price_currency, properties(title, type, address, city, province, floor_area_sqm, lot_area_sqm, bedrooms, bathrooms, parking_slots)')
      .in('id', listingIds)
      .eq('tenant_id', tenantId)
      .eq('status', 'active');
    if (ownError) throw ownError;

    for (const row of (ownRows ?? []) as unknown as ListingJoinRow[]) {
      resolvedListings.set(row.id, {
        listing_id: row.id,
        property_id: null,
        source: 'inventory',
        shared_by_handle: null,
        fields: fieldsFromListing(row),
      });
    }

    const remaining = listingIds.filter((id) => !resolvedListings.has(id));
    if (remaining.length > 0) {
      const { data: dockets, error: docketsError } = await supabase
        .from('listing_dockets')
        .select('source_listing_id, shared_by')
        .in('source_listing_id', remaining)
        .eq('shared_with', callerId)
        .eq('status', 'active');
      if (docketsError) throw docketsError;

      const sharerByListing = new Map((dockets ?? []).map((d) => [d.source_listing_id as string, d.shared_by as string]));
      const docketListingIds = [...sharerByListing.keys()];

      if (docketListingIds.length > 0) {
        const { data: docketRows, error: docketListingsError } = await supabaseAdmin
          .from('listings')
          .select('id, price, price_currency, properties(title, type, address, city, province, floor_area_sqm, lot_area_sqm, bedrooms, bathrooms, parking_slots)')
          .in('id', docketListingIds)
          .eq('status', 'active');
        if (docketListingsError) throw docketListingsError;

        const sharerIds = [...new Set(sharerByListing.values())];
        const { data: sharers, error: sharersError } = await supabaseAdmin
          .from('profiles')
          .select('id, handle')
          .in('id', sharerIds);
        if (sharersError) throw sharersError;
        const handleById = new Map((sharers ?? []).map((s) => [s.id as string, s.handle as string]));

        for (const row of (docketRows ?? []) as unknown as ListingJoinRow[]) {
          const sharedBy = sharerByListing.get(row.id) ?? null;
          resolvedListings.set(row.id, {
            listing_id: row.id,
            property_id: null,
            source: 'docket',
            shared_by_handle: sharedBy ? (handleById.get(sharedBy) ?? null) : null,
            fields: fieldsFromListing(row),
          });
        }
      }
    }
  }

  if (propertyIds.length > 0) {
    const { data: propRows, error: propError } = await supabase
      .from('properties')
      .select('id, title, type, address, city, province, floor_area_sqm, lot_area_sqm, bedrooms, bathrooms, parking_slots, price, price_currency, projects(name)')
      .in('id', propertyIds)
      .eq('tenant_id', tenantId)
      .not('project_id', 'is', null);
    if (propError) throw propError;

    for (const row of (propRows ?? []) as unknown as PropertyRow[]) {
      resolvedProperties.set(row.id, {
        listing_id: null,
        property_id: row.id,
        source: 'project_unit',
        shared_by_handle: null,
        fields: fieldsFromProperty(row),
      });
    }
  }

  const results: ResolvedMatchItem[] = [];
  const invalid: string[] = [];
  for (const entry of order) {
    const resolved = entry.kind === 'listing' ? resolvedListings.get(entry.id) : resolvedProperties.get(entry.id);
    if (!resolved) {
      invalid.push(entry.id);
      continue;
    }
    results.push(resolved);
  }

  if (invalid.length > 0) {
    return {
      ok: false,
      error: `Not found, not active, not yours, or not shared with you: ${invalid.join(', ')}`,
    };
  }

  return { ok: true, items: results };
}
