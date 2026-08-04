import type { FastifyInstance } from 'fastify';
import { requireAuth, getScopedClient } from '../lib/auth.js';
import type { SettingKey } from '../lib/settingsDelegation.js';

const SETTING_KEYS: SettingKey[] = ['sharing_templates', 'performance', 'matching', 'tasks', 'commission'];

type PutPermissionBody = {
  setting_key?: string;
  granted?: boolean;
};

type ProfileRow = { id: string; full_name: string; handle: string | null; role: string };
type DelegationRow = { member_id: string; setting_key: SettingKey };

// tb-brokerage-permissions-delegation-001: the one Settings sub-section not
// shown to (or delegable by) anyone but an admin -- delegating who can
// delegate would defeat the point. GET/PUT both re-check role === 'admin'
// server-side rather than trusting the frontend's own admin-only rendering.
export async function registerSettingsPermissionsRoutes(app: FastifyInstance) {
  app.get('/settings/permissions', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user!.role !== 'admin') {
      return reply.status(403).send({ error: 'Only an admin can view settings permissions' });
    }

    const supabase = getScopedClient(request);
    const tenantId = request.user!.tenantId;

    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, full_name, handle, role')
      .eq('tenant_id', tenantId)
      .neq('id', request.user!.id)
      .returns<ProfileRow[]>();

    if (profilesError) {
      request.log.error(profilesError);
      return reply.status(500).send({ error: 'Could not load tenant members' });
    }

    const { data: delegations, error: delegationsError } = await supabase
      .from('settings_edit_delegations')
      .select('member_id, setting_key')
      .eq('tenant_id', tenantId)
      .returns<DelegationRow[]>();

    if (delegationsError) {
      request.log.error(delegationsError);
      return reply.status(500).send({ error: 'Could not load delegation grants' });
    }

    const grantedKeysByMember = new Map<string, Set<SettingKey>>();
    for (const row of delegations ?? []) {
      const keys = grantedKeysByMember.get(row.member_id) ?? new Set<SettingKey>();
      keys.add(row.setting_key);
      grantedKeysByMember.set(row.member_id, keys);
    }

    const members = (profiles ?? [])
      .filter((profile) => profile.role !== 'admin')
      .map((profile) => {
        const keys = grantedKeysByMember.get(profile.id) ?? new Set<SettingKey>();
        return {
          member_id: profile.id,
          full_name: profile.full_name,
          handle: profile.handle,
          sharing_templates: keys.has('sharing_templates'),
          performance: keys.has('performance'),
          matching: keys.has('matching'),
          tasks: keys.has('tasks'),
          commission: keys.has('commission'),
        };
      });

    return { members };
  });

  app.put<{ Params: { memberId: string }; Body: PutPermissionBody }>(
    '/settings/permissions/:memberId',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (request.user!.role !== 'admin') {
        return reply.status(403).send({ error: 'Only an admin can edit settings permissions' });
      }

      const { setting_key, granted } = request.body ?? {};
      if (!setting_key || !SETTING_KEYS.includes(setting_key as SettingKey)) {
        return reply.status(400).send({ error: `setting_key must be one of: ${SETTING_KEYS.join(', ')}` });
      }
      if (typeof granted !== 'boolean') {
        return reply.status(400).send({ error: 'granted must be a boolean' });
      }

      const tenantId = request.user!.tenantId;
      const supabase = getScopedClient(request);

      // Never trust an ID from the request -- confirm the target member is a
      // real profile in the caller's own tenant before touching anything.
      const { data: targetProfile, error: targetError } = await supabase
        .from('profiles')
        .select('id, role')
        .eq('id', request.params.memberId)
        .eq('tenant_id', tenantId)
        .maybeSingle<{ id: string; role: string }>();

      if (targetError) {
        request.log.error(targetError);
        return reply.status(500).send({ error: 'Could not verify the target member' });
      }
      if (!targetProfile) {
        return reply.status(404).send({ error: 'Member not found in your workspace' });
      }
      if (targetProfile.role === 'admin') {
        return reply
          .status(400)
          .send({ error: "Cannot grant a delegation to an admin -- their edit rights already come from their role" });
      }

      // settings_edit_delegations' own insert/update/delete RLS policies
      // (admin-only, see the migration) are the real enforcement here -- this
      // route's own role check above only exists for a clean 403. The write
      // goes through the caller's own scoped client, not a service-role
      // bypass.
      if (granted) {
        const { error } = await supabase.from('settings_edit_delegations').upsert(
          {
            tenant_id: tenantId,
            member_id: request.params.memberId,
            setting_key: setting_key as SettingKey,
            granted_by: request.user!.id,
          },
          { onConflict: 'tenant_id,member_id,setting_key' },
        );

        if (error) {
          request.log.error(error);
          return reply.status(500).send({ error: 'Could not save the delegation grant' });
        }
      } else {
        const { error } = await supabase
          .from('settings_edit_delegations')
          .delete()
          .eq('tenant_id', tenantId)
          .eq('member_id', request.params.memberId)
          .eq('setting_key', setting_key as SettingKey);

        if (error) {
          request.log.error(error);
          return reply.status(500).send({ error: 'Could not revoke the delegation grant' });
        }
      }

      return { member_id: request.params.memberId, setting_key, granted };
    },
  );
}
