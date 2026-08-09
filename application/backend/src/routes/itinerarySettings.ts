import type { FastifyInstance } from 'fastify';
import { requireAuth, getScopedClient } from '../lib/auth.js';
import { canEditSetting } from '../lib/settingsDelegation.js';
import { getServiceAccountEmail } from '../lib/googleDocs.js';

type ItinerarySettingsBody = {
  recipient_email?: string | null;
  drive_folder_id?: string | null;
  template_document_id?: string | null;
};

// tb-buyer-leads-itinerary-settings-001: an admin pastes a Drive folder or
// Google Doc URL, not a bare ID -- this codebase's UI convention for these
// three fields is "ID/URL" (see the settings panel), so URLs are normalized
// to their file ID here rather than stored raw and re-parsed at generation
// time. A bare ID (no slashes) passes through unchanged.
function extractGoogleFileId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/\/(?:folders|d)\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : trimmed;
}

// tb-buyer-leads-itinerary-settings-001: same GET/PATCH shape as
// shareText.ts's /settings/share-templates -- the caller's own scoped
// client for both reads (RLS select-any-member) and writes (RLS
// has_settings_delegation('itinerary') is the real backstop; the app-level
// canEditSetting() check here only exists to return a clean 403 instead of
// a generic Postgres/RLS failure).
export async function registerItinerarySettingsRoutes(app: FastifyInstance) {
  app.get('/settings/itinerary', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const { data, error } = await supabase
      .from('workspace_itinerary_settings')
      .select('recipient_email, drive_folder_id, template_document_id')
      .eq('tenant_id', request.user!.tenantId)
      .single();

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not load itinerary settings' });
    }

    const can_edit = await canEditSetting(
      supabase,
      request.user!.tenantId,
      request.user!.id,
      request.user!.role,
      'itinerary',
    );
    return { ...data, service_account_email: getServiceAccountEmail(), can_edit };
  });

  app.patch<{ Body: ItinerarySettingsBody }>('/settings/itinerary', { preHandler: requireAuth }, async (request, reply) => {
    const supabase = getScopedClient(request);
    const canEdit = await canEditSetting(
      supabase,
      request.user!.tenantId,
      request.user!.id,
      request.user!.role,
      'itinerary',
    );
    if (!canEdit) {
      return reply.status(403).send({ error: 'Only an admin or a delegated member can edit itinerary settings' });
    }

    const { recipient_email, drive_folder_id, template_document_id } = request.body ?? {};
    if (recipient_email === undefined && drive_folder_id === undefined && template_document_id === undefined) {
      return reply
        .status(400)
        .send({ error: 'recipient_email, drive_folder_id, or template_document_id is required' });
    }

    const { data, error } = await supabase
      .from('workspace_itinerary_settings')
      .update({
        ...(recipient_email !== undefined && { recipient_email: recipient_email || null }),
        ...(drive_folder_id !== undefined && { drive_folder_id: extractGoogleFileId(drive_folder_id) }),
        ...(template_document_id !== undefined && { template_document_id: extractGoogleFileId(template_document_id) }),
      })
      .eq('tenant_id', request.user!.tenantId)
      .select('recipient_email, drive_folder_id, template_document_id')
      .single();

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Could not save itinerary settings' });
    }
    return { ...data, service_account_email: getServiceAccountEmail(), can_edit: true };
  });
}
