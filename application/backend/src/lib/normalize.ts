// tb-migration-value-normalization-001: deterministic (regex + static lookup)
// value-shape fixes for real-world CSV data, applied after column mapping,
// before/during preview. Currency stripping already happens for free inside
// transform.ts's existing numeric-field coercion (see that tracer bullet's
// Context) -- this file covers the two gaps that actually need new logic:
// property-type synonyms and city/province classification.

const PROPERTY_TYPE_SYNONYMS: Record<string, string> = {
  house: 'house_and_lot',
  'house and lot': 'house_and_lot',
  'house & lot': 'house_and_lot',
  'single detached': 'house_and_lot',
  condo: 'condo_unit',
  condominium: 'condo_unit',
  'condo unit': 'condo_unit',
  unit: 'condo_unit',
  townhouse: 'townhouse',
  'town house': 'townhouse',
  lot: 'lot_only',
  'lot only': 'lot_only',
  'vacant lot': 'lot_only',
  warehouse: 'warehouse',
  commercial: 'commercial',
  'commercial space': 'commercial',
  agricultural: 'agricultural',
  farm: 'agricultural',
  farmland: 'agricultural',
  industrial: 'industrial',
  // extend as real-world synonyms are found during implementation/testing
};

export function normalizePropertyType(raw: string, knownEnum: Set<string>): { value: string; warning?: string } {
  if (knownEnum.has(raw)) return { value: raw };
  const synonym = PROPERTY_TYPE_SYNONYMS[raw.trim().toLowerCase()];
  if (synonym) return { value: synonym };
  return { value: raw, warning: `type: "${raw}" is not a recognized property type` };
}

// Not exhaustive -- covers PH provinces (a fixed, well-known set) and the
// highly-urbanized/major cities most likely to appear in a real brokerage
// CRM export. Extend as real-world place names are found during
// implementation/testing, same spirit as the property-type synonyms above.
const PH_PROVINCES = new Set(
  [
    'Abra', 'Agusan del Norte', 'Agusan del Sur', 'Aklan', 'Albay', 'Antique', 'Apayao',
    'Aurora', 'Basilan', 'Bataan', 'Batanes', 'Batangas', 'Benguet', 'Biliran', 'Bohol',
    'Bukidnon', 'Bulacan', 'Cagayan', 'Camarines Norte', 'Camarines Sur', 'Camiguin', 'Capiz',
    'Catanduanes', 'Cavite', 'Cebu', 'Cotabato', 'Davao de Oro', 'Davao del Norte',
    'Davao del Sur', 'Davao Occidental', 'Davao Oriental', 'Dinagat Islands', 'Eastern Samar',
    'Guimaras', 'Ifugao', 'Ilocos Norte', 'Ilocos Sur', 'Iloilo', 'Isabela', 'Kalinga',
    'La Union', 'Laguna', 'Lanao del Norte', 'Lanao del Sur', 'Leyte', 'Maguindanao del Norte',
    'Maguindanao del Sur', 'Marinduque', 'Masbate', 'Misamis Occidental', 'Misamis Oriental',
    'Mountain Province', 'Negros Occidental', 'Negros Oriental', 'Northern Samar',
    'Nueva Ecija', 'Nueva Vizcaya', 'Occidental Mindoro', 'Oriental Mindoro', 'Palawan',
    'Pampanga', 'Pangasinan', 'Quezon', 'Quirino', 'Rizal', 'Romblon', 'Samar', 'Sarangani',
    'Siquijor', 'Sorsogon', 'South Cotabato', 'Southern Leyte', 'Sultan Kudarat', 'Sulu',
    'Surigao del Norte', 'Surigao del Sur', 'Tarlac', 'Tawi-Tawi', 'Zambales',
    'Zamboanga del Norte', 'Zamboanga del Sur', 'Zamboanga Sibugay', 'Metro Manila',
  ].map((p) => p.toLowerCase()),
);

const PH_CITIES = new Set(
  [
    'Manila', 'Quezon City', 'Makati', 'Taguig', 'Pasig', 'Mandaluyong', 'San Juan', 'Marikina',
    'Pasay', 'Parañaque', 'Las Piñas', 'Muntinlupa', 'Caloocan', 'Malabon', 'Navotas',
    'Valenzuela', 'Cebu City', 'Mandaue', 'Lapu-Lapu', 'Talisay', 'Davao City', 'Tagum',
    'Panabo', 'Iloilo City', 'Bacolod', 'Cagayan de Oro', 'Zamboanga City', 'General Santos',
    'Baguio', 'Angeles City', 'San Fernando', 'Olongapo', 'Dagupan', 'Batangas City', 'Lucena',
    'Naga', 'Legazpi', 'Tacloban', 'Butuan', 'Surigao City', 'Puerto Princesa', 'Antipolo',
    'Calamba', 'Santa Rosa', 'Biñan', 'Dasmariñas', 'Bacoor', 'Imus', 'Tarlac City',
    'Cabanatuan', 'Malolos', 'Meycauayan', 'San Jose del Monte', 'Iligan', 'Ormoc',
    'Roxas City', 'Kidapawan', 'Koronadal', 'Tagbilaran', 'Dumaguete', 'Cotabato City',
    'Marawi',
  ].map((c) => c.toLowerCase()),
);

// Strips a trailing "City" suffix before matching ("Makati City" -> "makati")
// since real CRM data mixes both forms for the same place.
function stripCitySuffix(value: string): string {
  return value.replace(/\s+city$/i, '').trim();
}

export type LocationClassification = { field: 'city' | 'province'; value: string } | null;

export function classifyLocation(raw: string): LocationClassification {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  const lowerNoSuffix = stripCitySuffix(trimmed).toLowerCase();

  if (PH_PROVINCES.has(lower)) return { field: 'province', value: trimmed };
  if (PH_CITIES.has(lower) || PH_CITIES.has(lowerNoSuffix)) return { field: 'city', value: trimmed };
  return null;
}
