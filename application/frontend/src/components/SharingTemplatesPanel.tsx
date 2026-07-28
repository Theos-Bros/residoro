import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchShareTemplates, updateShareTemplates } from '@/lib/shareTextApi';
import { RichTextEditor } from '@/components/RichTextEditor';
import { Button } from '@/components/ui/button';

type Props = {
  session: Session;
};

const MERGE_FIELDS = [
  'title', 'type', 'address', 'city', 'province', 'price', 'price_currency',
  'listing_type', 'bedrooms', 'bathrooms', 'floor_area_sqm', 'lot_area_sqm', 'parking_slots',
];
const CO_BROKER_ONLY_FIELD = 'commission_note';

// tb-buyer-leads-broadcast-001: a Buyer Wanted broadcast merges a buyer
// requirement's own fields (inquiries/buyer_requirements), not a
// listing/property's -- a disjoint field set from MERGE_FIELDS above.
const BUYER_WANTED_MERGE_FIELDS = [
  'intent', 'property_type', 'budget_min', 'budget_max', 'budget_range',
  'target_city', 'target_province', 'bedrooms', 'bathrooms',
  'floor_area_sqm_min', 'lot_area_sqm_min', 'contact_name',
];

// tb-distribution-share-text-001: Settings' first sub-section. Internal
// audience has no template here by design -- it's a fixed full-detail dump
// built server-side (see cap-distribution-001 Decision #4), so it never gets
// an editor. tb-buyer-leads-broadcast-001 added a third, Buyer Wanted, below.
//
// tb-brokerage-permissions-delegation-001: editability now reads off the
// fetched resource's own can_edit (server-computed: role === 'admin' OR a
// matching delegation grant) instead of an canEdit prop, so a delegated
// non-admin member gets the same editable experience an admin always has,
// with no separate code path.
export function SharingTemplatesPanel({ session }: Props) {
  const [publicTemplate, setPublicTemplate] = useState('');
  const [coBrokerTemplate, setCoBrokerTemplate] = useState('');
  const [buyerWantedTemplate, setBuyerWantedTemplate] = useState('');
  const [canEdit, setCanEdit] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchShareTemplates(session.access_token)
      .then((templates) => {
        setPublicTemplate(templates.public_share_template ?? '');
        setCoBrokerTemplate(templates.co_broker_share_template ?? '');
        setBuyerWantedTemplate(templates.buyer_wanted_share_template ?? '');
        setCanEdit(templates.can_edit);
        setLoaded(true);
      })
      .catch((err: Error) => setError(err.message));
  }, [session.access_token]);

  async function handleSave() {
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const templates = await updateShareTemplates(session.access_token, {
        public_share_template: publicTemplate,
        co_broker_share_template: coBrokerTemplate,
        buyer_wanted_share_template: buyerWantedTemplate,
      });
      setCanEdit(templates.can_edit);
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
      {!canEdit && (
        <p className="text-sm text-muted-foreground">
          Only an admin, or a member granted edit access, can edit sharing templates. You can
          still use them from a listing's "Share Details" button.
        </p>
      )}

      {loaded && (
        <>
          <div className="space-y-2">
            <label className="text-sm font-medium">Public template</label>
            <p className="text-xs text-muted-foreground">
              Merge fields: {MERGE_FIELDS.map((f) => `{{${f}}}`).join(', ')}
            </p>
            <RichTextEditor value={publicTemplate} onChange={setPublicTemplate} editable={canEdit} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Co-broker template</label>
            <p className="text-xs text-muted-foreground">
              Merge fields: {MERGE_FIELDS.map((f) => `{{${f}}}`).join(', ')}, {`{{${CO_BROKER_ONLY_FIELD}}}`}
            </p>
            <RichTextEditor value={coBrokerTemplate} onChange={setCoBrokerTemplate} editable={canEdit} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Buyer Wanted template</label>
            <p className="text-xs text-muted-foreground">
              Used for the "Buyer Wanted" broadcast — merge fields come from the buyer's
              requirement, not a listing. Merge fields:{' '}
              {BUYER_WANTED_MERGE_FIELDS.map((f) => `{{${f}}}`).join(', ')}
            </p>
            <RichTextEditor value={buyerWantedTemplate} onChange={setBuyerWantedTemplate} editable={canEdit} />
          </div>

          {canEdit && (
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
