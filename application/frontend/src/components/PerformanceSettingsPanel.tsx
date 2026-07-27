import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchPerformanceSettings, updatePerformanceSettings } from '@/lib/analyticsApi';
import { Button } from '@/components/ui/button';

type Props = {
  session: Session;
};

// tb-analytics-share-performance-001: Settings' second sub-section, following
// SharingTemplatesPanel's exact view-all/edit-gated shape -- everyone loads
// and sees the current threshold, only a caller with edit rights gets an
// editable input and Save button.
//
// tb-brokerage-permissions-delegation-001: editability now reads off the
// fetched resource's own can_edit (server-computed: role === 'admin' OR a
// matching delegation grant) instead of an canEdit prop.
export function PerformanceSettingsPanel({ session }: Props) {
  const [threshold, setThreshold] = useState(3);
  const [canEdit, setCanEdit] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchPerformanceSettings(session.access_token)
      .then((settings) => {
        setThreshold(settings.hot_share_threshold);
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
      const settings = await updatePerformanceSettings(session.access_token, threshold);
      setThreshold(settings.hot_share_threshold);
      setCanEdit(settings.can_edit);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-md space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Performance</h2>
        <p className="text-sm text-muted-foreground">
          A listing is flagged 🔥 Hot on the Performance page once it's been shared this many times
          in the trailing 30 days.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!canEdit && (
        <p className="text-sm text-muted-foreground">
          Only an admin, or a member granted edit access, can edit the Hot threshold. You can
          still view the Performance page.
        </p>
      )}

      {loaded && (
        <>
          <div className="space-y-2">
            <label className="text-sm font-medium">Hot threshold (shares / 30 days)</label>
            <input
              type="number"
              min={1}
              step={1}
              value={threshold}
              disabled={!canEdit}
              onChange={(e) => setThreshold(Math.max(1, Math.round(Number(e.target.value))))}
              className="h-9 w-32 rounded-md border border-input px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
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
