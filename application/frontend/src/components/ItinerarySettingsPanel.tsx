import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchItinerarySettings, updateItinerarySettings } from '@/lib/itineraryApi';
import { Button } from '@/components/ui/button';

type Props = {
  session: Session;
};

// tb-buyer-leads-itinerary-settings-001: Settings' seventh sub-section,
// following CommissionSettingsPanel's plain-input view-all/edit-gated shape.
// Any of the three fields left blank falls back to
// tb-buyer-leads-match-itinerary-001's original behavior for that piece
// (plain-text builder, no folder, agent-only share) -- additive
// configuration, not a prerequisite for itinerary generation to work at all.
export function ItinerarySettingsPanel({ session }: Props) {
  const [recipientEmail, setRecipientEmail] = useState('');
  const [driveFolderId, setDriveFolderId] = useState('');
  const [templateDocumentId, setTemplateDocumentId] = useState('');
  const [serviceAccountEmail, setServiceAccountEmail] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchItinerarySettings(session.access_token)
      .then((settings) => {
        setRecipientEmail(settings.recipient_email ?? '');
        setDriveFolderId(settings.drive_folder_id ?? '');
        setTemplateDocumentId(settings.template_document_id ?? '');
        setServiceAccountEmail(settings.service_account_email);
        setCanEdit(settings.can_edit);
        setLoaded(true);
      })
      .catch((err: Error) => setError(err.message));
  }, [session.access_token]);

  async function handleSave() {
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const settings = await updateItinerarySettings(session.access_token, {
        recipient_email: recipientEmail || null,
        drive_folder_id: driveFolderId || null,
        template_document_id: templateDocumentId || null,
      });
      setRecipientEmail(settings.recipient_email ?? '');
      setDriveFolderId(settings.drive_folder_id ?? '');
      setTemplateDocumentId(settings.template_document_id ?? '');
      setCanEdit(settings.can_edit);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Itinerary</h2>
        <p className="text-sm text-muted-foreground">
          Configure a branded template, a Drive folder, and a standing recipient for generated
          showing itineraries. Leaving any of these blank falls back to the plain-text,
          no-folder, agent-only-share default.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!canEdit && (
        <p className="text-sm text-muted-foreground">
          Only an admin, or a member granted edit access, can edit itinerary settings.
        </p>
      )}

      {loaded && (
        <>
          {serviceAccountEmail && (
            <p className="rounded-md border border-input bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              Before setting a template or folder below, share it with{' '}
              <code className="rounded bg-muted px-1 py-0.5">{serviceAccountEmail}</code> in Google
              Drive first — this app can only copy a template or file into a folder it's been
              explicitly given access to. This is a one-time, per-item step done in Google Drive
              itself, not something this page can do for you.
            </p>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Standing recipient email</label>
            <p className="text-xs text-muted-foreground">
              Always gets writer access on a generated itinerary, in addition to the requesting
              agent.
            </p>
            <input
              type="email"
              value={recipientEmail}
              disabled={!canEdit}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="office@yourbrokerage.com"
              className="h-9 w-full rounded-md border border-input px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Drive folder ID or URL</label>
            <p className="text-xs text-muted-foreground">
              Generated itineraries are filed here instead of the service account's own Drive.
            </p>
            <input
              type="text"
              value={driveFolderId}
              disabled={!canEdit}
              onChange={(e) => setDriveFolderId(e.target.value)}
              placeholder="Folder ID or https://drive.google.com/drive/folders/..."
              className="h-9 w-full rounded-md border border-input px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Template Google Doc ID or URL</label>
            <p className="text-xs text-muted-foreground">
              Copied and merge-filled instead of building a plain-text doc. Placeholders:{' '}
              {['{{title}}', '{{buyer_name}}', '{{items_table}}'].join(', ')}
            </p>
            <input
              type="text"
              value={templateDocumentId}
              disabled={!canEdit}
              onChange={(e) => setTemplateDocumentId(e.target.value)}
              placeholder="Document ID or https://docs.google.com/document/d/.../edit"
              className="h-9 w-full rounded-md border border-input px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          {canEdit && (
            <div className="flex items-center gap-3">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
              {saved && <span className="text-sm text-muted-foreground">Saved.</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
