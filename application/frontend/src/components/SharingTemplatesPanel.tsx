import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchShareTemplates, updateShareTemplates } from '@/lib/shareTextApi';
import { RichTextEditor } from '@/components/RichTextEditor';
import { Button } from '@/components/ui/button';

type Props = {
  session: Session;
  isAdmin: boolean;
};

const MERGE_FIELDS = [
  'title', 'type', 'address', 'city', 'province', 'price', 'price_currency',
  'listing_type', 'bedrooms', 'bathrooms', 'floor_area_sqm', 'lot_area_sqm', 'parking_slots',
];
const CO_BROKER_ONLY_FIELD = 'commission_note';

// tb-distribution-share-text-001: Settings' first (and, for now, only)
// sub-section. Internal audience has no template here by design -- it's a
// fixed full-detail dump built server-side (see cap-distribution-001
// Decision #4), so only Public/Co-broker get an editor.
export function SharingTemplatesPanel({ session, isAdmin }: Props) {
  const [publicTemplate, setPublicTemplate] = useState('');
  const [coBrokerTemplate, setCoBrokerTemplate] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchShareTemplates(session.access_token)
      .then((templates) => {
        setPublicTemplate(templates.public_share_template ?? '');
        setCoBrokerTemplate(templates.co_broker_share_template ?? '');
        setLoaded(true);
      })
      .catch((err: Error) => setError(err.message));
  }, [session.access_token]);

  async function handleSave() {
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      await updateShareTemplates(session.access_token, {
        public_share_template: publicTemplate,
        co_broker_share_template: coBrokerTemplate,
      });
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
        <h2 className="text-lg font-semibold tracking-tight">Sharing Templates</h2>
        <p className="text-sm text-muted-foreground">
          Write once, reuse for every listing — merge fields are replaced with that listing's
          current data whenever an agent shares it.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!isAdmin && (
        <p className="text-sm text-muted-foreground">
          Only an admin can edit sharing templates. You can still use them from a listing's
          "Share Details" button.
        </p>
      )}

      {loaded && (
        <>
          <div className="space-y-2">
            <label className="text-sm font-medium">Public template</label>
            <p className="text-xs text-muted-foreground">
              Merge fields: {MERGE_FIELDS.map((f) => `{{${f}}}`).join(', ')}
            </p>
            <RichTextEditor value={publicTemplate} onChange={setPublicTemplate} editable={isAdmin} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Co-broker template</label>
            <p className="text-xs text-muted-foreground">
              Merge fields: {MERGE_FIELDS.map((f) => `{{${f}}}`).join(', ')}, {`{{${CO_BROKER_ONLY_FIELD}}}`}
            </p>
            <RichTextEditor value={coBrokerTemplate} onChange={setCoBrokerTemplate} editable={isAdmin} />
          </div>

          {isAdmin && (
            <div className="flex items-center gap-3">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save templates'}
              </Button>
              {saved && <span className="text-sm text-muted-foreground">Saved.</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
