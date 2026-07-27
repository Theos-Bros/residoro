const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export type InquiryStage = 'to_probe' | 'probing' | 'not_qualified' | 'qualified';
export type Intent = 'buy' | 'lease';
export type RequirementPropertyType =
  | 'condo_unit'
  | 'house_and_lot'
  | 'lot_only'
  | 'townhouse'
  | 'commercial'
  | 'warehouse'
  | 'agricultural'
  | 'industrial';

export const INQUIRY_STAGES: readonly InquiryStage[] = ['to_probe', 'probing', 'not_qualified', 'qualified'];
export const INTENTS: readonly Intent[] = ['buy', 'lease'];
export const REQUIREMENT_PROPERTY_TYPES: readonly RequirementPropertyType[] = [
  'condo_unit',
  'house_and_lot',
  'lot_only',
  'townhouse',
  'commercial',
  'warehouse',
  'agricultural',
  'industrial',
];

export type RequirementFields = {
  intent?: Intent | null;
  property_type?: RequirementPropertyType | null;
  budget_min?: number | null;
  budget_max?: number | null;
  budget_currency?: string | null;
  target_city?: string | null;
  target_province?: string | null;
  floor_area_sqm_min?: number | null;
  lot_area_sqm_min?: number | null;
  storeys?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  household_adults?: number | null;
  household_kids?: number | null;
  household_pets?: number | null;
  notes?: string | null;
};

export type Inquiry = RequirementFields & {
  id: string;
  tenant_id: string;
  stage: InquiryStage;
  probed_by: string | null;
  source: string | null;
  buyer_name: string | null;
  buyer_phone: string | null;
  buyer_email: string | null;
  buyer_address: string | null;
  promoted_lead_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

async function parseJsonOrThrow(response: Response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

export async function fetchInquiry(accessToken: string, id: string): Promise<Inquiry> {
  const response = await fetch(`${BACKEND_URL}/inquiries/${id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function fetchInquiries(
  accessToken: string,
  opts?: { stage?: InquiryStage; includeArchived?: boolean },
): Promise<{ inquiries: Inquiry[] }> {
  const params = new URLSearchParams();
  if (opts?.stage) params.set('stage', opts.stage);
  if (opts?.includeArchived) params.set('include_archived', 'true');
  const query = params.toString();
  const response = await fetch(`${BACKEND_URL}/inquiries${query ? `?${query}` : ''}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function createInquiry(
  accessToken: string,
  input: RequirementFields & {
    buyer_name?: string;
    buyer_phone?: string;
    buyer_email?: string;
    buyer_address?: string;
    source?: string;
  },
): Promise<Inquiry> {
  const response = await fetch(`${BACKEND_URL}/inquiries`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}

export async function updateInquiry(
  accessToken: string,
  id: string,
  patch: RequirementFields & {
    stage?: InquiryStage;
    buyer_name?: string;
    buyer_phone?: string;
    buyer_email?: string;
    buyer_address?: string;
    source?: string;
  },
): Promise<Inquiry> {
  const response = await fetch(`${BACKEND_URL}/inquiries/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return parseJsonOrThrow(response);
}

export async function qualifyInquiry(
  accessToken: string,
  id: string,
  input: { contact_id: string } | { create_contact: { name: string; phone?: string; email?: string } },
): Promise<{ inquiry: Inquiry; lead: unknown }> {
  const response = await fetch(`${BACKEND_URL}/inquiries/${id}/qualify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(response);
}

export async function archiveInquiry(accessToken: string, id: string): Promise<Inquiry> {
  const response = await fetch(`${BACKEND_URL}/inquiries/${id}/archive`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJsonOrThrow(response);
}

export async function deleteInquiry(accessToken: string, id: string): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/inquiries/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
}
