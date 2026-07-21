// Read-only mirror of the day-math used by the Edge Function
// (supabase/functions/contract-expiry-check/index.ts) that actually owns
// state transitions. This backend copy only computes which warning tier (if
// any) to show in the UI -- it never writes access_state or warning_*_sent_at.
export type WarningTier = '30d' | '7d' | '1d';

export function daysUntil(dateStr: string): number {
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const [y, m, d] = dateStr.split('-').map(Number);
  const targetUtc = Date.UTC(y, m - 1, d);
  return Math.round((targetUtc - todayUtc) / 86_400_000);
}

export function activeWarningTier(days: number): WarningTier | null {
  if (days > 0 && days <= 1) return '1d';
  if (days > 1 && days <= 7) return '7d';
  if (days > 7 && days <= 30) return '30d';
  return null;
}
