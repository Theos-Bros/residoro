import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchCommissionSettings, updateCommissionSettings } from '@/lib/commissionApi';
import { Button } from '@/components/ui/button';

type Props = {
  session: Session;
};

// tb-commission-structure-001: Settings' sixth sub-section, following
// MatchingSettingsPanel's exact view-all/edit-gated shape -- everyone loads
// and sees the current default split, only a caller with edit rights (admin
// or a 'commission' delegation grant) gets editable inputs and a Save
// button. The three percentages must sum to 100 -- enforced both here
// (disabled Save until true) and at the DB layer.
export function CommissionSettingsPanel({ session }: Props) {
  const [brokeragePct, setBrokeragePct] = useState(50);
  const [agentPct, setAgentPct] = useState(50);
  const [coBrokerPct, setCoBrokerPct] = useState(0);
  const [canEdit, setCanEdit] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchCommissionSettings(session.access_token)
      .then((settings) => {
        setBrokeragePct(settings.default_brokerage_pct);
        setAgentPct(settings.default_agent_pct);
        setCoBrokerPct(settings.default_co_broker_pct);
        setCanEdit(settings.can_edit);
        setLoaded(true);
      })
      .catch((err: Error) => setError(err.message));
  }, [session.access_token]);

  const total = brokeragePct + agentPct + coBrokerPct;

  async function handleSave() {
    setError(null);
    setSaved(false);
    if (total !== 100) {
      setError('Brokerage, agent, and co-broker percentages must add up to 100');
      return;
    }
    setSaving(true);
    try {
      const settings = await updateCommissionSettings(session.access_token, {
        default_brokerage_pct: brokeragePct,
        default_agent_pct: agentPct,
        default_co_broker_pct: coBrokerPct,
      });
      setBrokeragePct(settings.default_brokerage_pct);
      setAgentPct(settings.default_agent_pct);
      setCoBrokerPct(settings.default_co_broker_pct);
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
        <h2 className="text-lg font-semibold tracking-tight">Commission</h2>
        <p className="text-sm text-muted-foreground">
          Default split applied to every closed deal's commission — snapshotted onto each earnings
          record at the moment it's recorded, so changing this later never alters a past deal.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!canEdit && (
        <p className="text-sm text-muted-foreground">
          Only an admin, or a member granted edit access, can edit the commission split.
        </p>
      )}

      {loaded && (
        <>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Brokerage %</label>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={brokeragePct}
                disabled={!canEdit}
                onChange={(e) => setBrokeragePct(Math.min(100, Math.max(0, Number(e.target.value))))}
                className="h-9 w-32 rounded-md border border-input px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Agent %</label>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={agentPct}
                disabled={!canEdit}
                onChange={(e) => setAgentPct(Math.min(100, Math.max(0, Number(e.target.value))))}
                className="h-9 w-32 rounded-md border border-input px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Co-broker %</label>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={coBrokerPct}
                disabled={!canEdit}
                onChange={(e) => setCoBrokerPct(Math.min(100, Math.max(0, Number(e.target.value))))}
                className="h-9 w-32 rounded-md border border-input px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              />
              <p className="text-xs text-muted-foreground">Only relevant when the deal involved a docket-shared listing.</p>
            </div>
            <p className={`text-xs ${total === 100 ? 'text-muted-foreground' : 'text-destructive'}`}>Total: {total}%</p>
          </div>

          {canEdit && (
            <div className="flex items-center gap-3">
              <Button onClick={handleSave} disabled={saving || total !== 100}>
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
