import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchMatchingSettings, updateMatchingSettings } from '@/lib/matchingApi';
import { Button } from '@/components/ui/button';

type Props = {
  session: Session;
};

// tb-buyer-leads-matching-001: Settings' fourth sub-section, following
// PerformanceSettingsPanel's exact view-all/edit-gated shape -- everyone
// loads and sees the current threshold, only a caller with edit rights
// (admin or a 'matching' delegation grant) gets an editable input and Save
// button.
export function MatchingSettingsPanel({ session }: Props) {
  const [threshold, setThreshold] = useState(50);
  const [canEdit, setCanEdit] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchMatchingSettings(session.access_token)
      .then((settings) => {
        setThreshold(settings.match_score_threshold);
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
      const settings = await updateMatchingSettings(session.access_token, threshold);
      setThreshold(settings.match_score_threshold);
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
        <h2 className="text-lg font-semibold tracking-tight">Matching</h2>
        <p className="text-sm text-muted-foreground">
          A Search result counts as a good match once its score clears this threshold.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!canEdit && (
        <p className="text-sm text-muted-foreground">
          Only an admin, or a member granted edit access, can edit the match score threshold.
        </p>
      )}

      {loaded && (
        <>
          <div className="space-y-2">
            <label className="text-sm font-medium">Match score threshold (0–100)</label>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={threshold}
              disabled={!canEdit}
              onChange={(e) => setThreshold(Math.min(100, Math.max(0, Math.round(Number(e.target.value)))))}
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
