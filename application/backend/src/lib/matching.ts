// tb-buyer-leads-matching-001: pure scoring logic, no DB access -- shared by
// POST /inquiries/:id/search and POST /buyer-requirements/:id/search
// (routes/matching.ts), which supply candidates from both this tenant's own
// active listings and received, active shared dockets.
//
// Hard filters: `intent` is unconditionally hard (Decision from the scoping
// conversation, 2026-07-28 -- "let the users decide which fields will be
// hard filters... intent is the best hard filter for now"). Every other
// TOGGLE_FIELD can be marked hard per search by the caller; anything not
// marked is weighted-decay scored instead. A hard filter that can't be
// evaluated (the field is missing on the candidate -- relevant for dockets,
// whose included_fields may omit it) fails closed: the candidate is excluded
// rather than treated as an unverified pass. A missing field on a SCORED
// (non-hard) dimension is instead dropped from the weighted average and the
// remaining weights renormalize, so absence never drags the score toward 0.

export type Intent = 'buy' | 'lease';

const INTENT_TO_LISTING_TYPE: Record<Intent, 'sale' | 'lease'> = {
  buy: 'sale',
  lease: 'lease',
};

export type MatchableField = 'intent' | 'property_type' | 'budget' | 'location' | 'bedrooms' | 'bathrooms' | 'area';

// Toggle-able in the UI; `intent` is deliberately excluded -- it's always
// hard and never offered as a checkbox.
export const TOGGLE_FIELDS: readonly Exclude<MatchableField, 'intent'>[] = [
  'property_type',
  'budget',
  'location',
  'bedrooms',
  'bathrooms',
  'area',
];

// Initial defaults proposed in tb-buyer-leads-matching-001's Technical
// Design -- not user-validated against real usage, expected to need tuning.
const FIELD_WEIGHTS: Record<Exclude<MatchableField, 'intent'>, number> = {
  budget: 0.3,
  location: 0.25,
  property_type: 0.15,
  bedrooms: 0.15,
  bathrooms: 0.1,
  area: 0.05,
};

const MATCHED_THRESHOLD = 60;
const DECAY_BAND = 0.3; // linear decay to 0 at 30% outside the relevant bound

export type RequirementLike = {
  intent?: string | null;
  property_type?: string | null;
  budget_min?: number | null;
  budget_max?: number | null;
  target_city?: string | null;
  target_province?: string | null;
  floor_area_sqm_min?: number | null;
  lot_area_sqm_min?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
};

export type MatchCandidate = {
  listing_type?: string | null;
  property_type?: string | null;
  price?: number | null;
  city?: string | null;
  province?: string | null;
  floor_area_sqm?: number | null;
  lot_area_sqm?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
};

export type ScoreResult = {
  score: number;
  matched_fields: MatchableField[];
  excluded_fields: MatchableField[];
};

function scorePropertyType(requirement: RequirementLike, candidate: MatchCandidate): number | null {
  if (!requirement.property_type || candidate.property_type == null) return null;
  return requirement.property_type === candidate.property_type ? 100 : 0;
}

function scoreBudget(requirement: RequirementLike, candidate: MatchCandidate): number | null {
  if (requirement.budget_min == null && requirement.budget_max == null) return null;
  if (candidate.price == null) return null;

  const min = requirement.budget_min ?? -Infinity;
  const max = requirement.budget_max ?? Infinity;
  if (candidate.price >= min && candidate.price <= max) return 100;

  const nearBound = candidate.price < min ? min : max;
  if (!Number.isFinite(nearBound) || nearBound === 0) return null;
  const deviation = Math.abs(candidate.price - nearBound) / nearBound;
  return Math.max(0, Math.round(100 * (1 - deviation / DECAY_BAND)));
}

function scoreLocation(requirement: RequirementLike, candidate: MatchCandidate): number | null {
  if (!requirement.target_city && !requirement.target_province) return null;
  if (candidate.city == null && candidate.province == null) return null;

  if (requirement.target_city && candidate.city && requirement.target_city.toLowerCase() === candidate.city.toLowerCase()) {
    return 100;
  }
  if (
    requirement.target_province &&
    candidate.province &&
    requirement.target_province.toLowerCase() === candidate.province.toLowerCase()
  ) {
    return 50;
  }
  return 0;
}

function scoreCount(requiredValue: number | null | undefined, candidateValue: number | null | undefined): number | null {
  if (requiredValue == null || candidateValue == null) return null;
  const diff = Math.abs(requiredValue - candidateValue);
  if (diff === 0) return 100;
  if (diff === 1) return 60;
  return 20;
}

function scoreArea(requirement: RequirementLike, candidate: MatchCandidate): number | null {
  const requiredMin = requirement.floor_area_sqm_min ?? requirement.lot_area_sqm_min;
  const candidateValue = candidate.floor_area_sqm ?? candidate.lot_area_sqm;
  if (requiredMin == null || candidateValue == null || requiredMin === 0) return null;

  if (candidateValue >= requiredMin) return 100;
  const deviation = (requiredMin - candidateValue) / requiredMin;
  return Math.max(0, Math.round(100 * (1 - deviation / DECAY_BAND)));
}

const SCORERS: Record<Exclude<MatchableField, 'intent'>, (requirement: RequirementLike, candidate: MatchCandidate) => number | null> = {
  property_type: scorePropertyType,
  budget: scoreBudget,
  location: scoreLocation,
  bedrooms: (r, c) => scoreCount(r.bedrooms, c.bedrooms),
  bathrooms: (r, c) => scoreCount(r.bathrooms, c.bathrooms),
  area: scoreArea,
};

// Returns null when the candidate is excluded by a hard filter (intent
// always, plus whichever of TOGGLE_FIELDS were passed in hardFilterFields).
export function scoreListing(
  requirement: RequirementLike,
  candidate: MatchCandidate,
  hardFilterFields: readonly Exclude<MatchableField, 'intent'>[],
): ScoreResult | null {
  const matched_fields: MatchableField[] = [];
  const excluded_fields: MatchableField[] = [];

  if (requirement.intent) {
    const expected = INTENT_TO_LISTING_TYPE[requirement.intent as Intent];
    if (!expected || !candidate.listing_type || candidate.listing_type !== expected) return null;
    matched_fields.push('intent');
  }

  let weightedSum = 0;
  let weightTotal = 0;

  for (const field of TOGGLE_FIELDS) {
    const raw = SCORERS[field](requirement, candidate);
    const isHard = hardFilterFields.includes(field);

    if (isHard) {
      if (raw === null || raw < 100) return null;
      matched_fields.push(field);
      continue;
    }

    if (raw === null) continue;
    weightedSum += raw * FIELD_WEIGHTS[field];
    weightTotal += FIELD_WEIGHTS[field];
    if (raw >= MATCHED_THRESHOLD) matched_fields.push(field);
    else excluded_fields.push(field);
  }

  const score = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 0;
  return { score, matched_fields, excluded_fields };
}
