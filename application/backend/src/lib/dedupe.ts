import { supabaseAdmin } from './supabaseAdmin.js';

// tb-migration-deduplication-001: cap-migration-001's Milestone 3, scoped to
// properties only (see this tracer bullet's semantic_scope). Matches on
// address + city/province, case-insensitive and trimmed -- no fuzzy/
// coordinate matching yet, per the scoping decisions in the doc's Context.
export type PropertyConflictCandidate = {
  row_number: number;
  address: unknown;
  city: unknown;
  province: unknown;
};

export type PropertyConflict = {
  existing_property_id: string;
  existing_title: string;
};

function conflictKey(address: unknown, city: unknown, province: unknown): string | null {
  const a = typeof address === 'string' ? address.trim().toLowerCase() : '';
  const c = typeof city === 'string' ? city.trim().toLowerCase() : '';
  const p = typeof province === 'string' ? province.trim().toLowerCase() : '';
  // A row with no address at all can't meaningfully conflict with anything --
  // matching on blank-vs-blank would flag every address-less row as a
  // duplicate of every other one.
  if (!a) return null;
  return `${a}|${c}|${p}`;
}

// One query for the whole batch, not one per row -- candidates.length is
// bounded by the existing MAX_ROWS (10,000) cap, same scale the confirm-
// import endpoint already accepts running synchronously in the request.
export async function findPropertyConflicts(
  tenantId: string,
  candidates: PropertyConflictCandidate[],
): Promise<Map<number, PropertyConflict>> {
  const conflicts = new Map<number, PropertyConflict>();
  if (candidates.length === 0) return conflicts;

  const { data: existing, error } = await supabaseAdmin
    .from('properties')
    .select('id, title, address, city, province')
    .eq('tenant_id', tenantId);

  if (error || !existing) return conflicts;

  const existingByKey = new Map<string, PropertyConflict>();
  for (const property of existing) {
    const key = conflictKey(property.address, property.city, property.province);
    if (key) {
      existingByKey.set(key, { existing_property_id: property.id, existing_title: property.title });
    }
  }

  for (const candidate of candidates) {
    const key = conflictKey(candidate.address, candidate.city, candidate.province);
    if (!key) continue;
    const match = existingByKey.get(key);
    if (match) conflicts.set(candidate.row_number, match);
  }

  return conflicts;
}

export type ConflictResolution = 'skip' | 'create_new' | 'overwrite';

export function resolveAction(
  rowNumber: number,
  conflicts: Map<number, PropertyConflict>,
  resolutions: Record<number, ConflictResolution> | undefined,
): ConflictResolution {
  if (!conflicts.has(rowNumber)) return 'create_new';
  return resolutions?.[rowNumber] ?? 'skip';
}
