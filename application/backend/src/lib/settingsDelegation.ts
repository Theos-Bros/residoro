import type { SupabaseClient } from '@supabase/supabase-js';

export type SettingKey = 'sharing_templates' | 'performance' | 'matching' | 'tasks' | 'commission';

// Shared by every Settings sub-section's GET (to compute can_edit) and PATCH
// (to gate the write) -- tb-brokerage-permissions-delegation-001. An admin's
// edit rights always come from role, never from a delegation row, so this
// short-circuits before touching the table at all.
export async function canEditSetting(
  supabase: SupabaseClient,
  tenantId: string,
  callerId: string,
  role: string,
  settingKey: SettingKey,
): Promise<boolean> {
  if (role === 'admin') return true;

  const { data } = await supabase
    .from('settings_edit_delegations')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('member_id', callerId)
    .eq('setting_key', settingKey)
    .maybeSingle();

  return !!data;
}
