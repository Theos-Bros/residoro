import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchProfile, updateProfile } from '@/lib/profileApi';
import { Button } from '@/components/ui/button';

type Props = {
  session: Session;
};

// tb-user-profile-display-name-001: cap-user-profile-001's first tracer
// bullet -- full_name only, shared verbatim by BrokerageLayout (tenant
// users) and AdminLayout (operators) since /me/profile is identical for
// both identity types. One component, not two per-app wrappers -- the admin
// dashboard already reuses top-level src/pages components (e.g. AuthPage),
// so no new sharing convention is introduced here.
//
// tb-user-profile-email-prefix-001: adds email (read-only, never editable
// here -- changing login email is separate, later scope) and prefix
// (editable, same Save button as the name fields).
//
// tb-user-profile-name-split-001: full_name replaced by separate first/last
// name inputs -- first name required, last name optional, same partial-
// update semantics as prefix.
//
// tb-employee-position-001: position is shown read-only, same treatment as
// email -- it has no client-facing update grant, admin-set only via the
// Team page.
export function ProfileSettingsPage({ session }: Props) {
  const [email, setEmail] = useState<string | null>(null);
  const [position, setPosition] = useState<string | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [prefix, setPrefix] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchProfile(session.access_token)
      .then((profile) => {
        setEmail(profile.email);
        setPosition(profile.position);
        setFirstName(profile.first_name ?? '');
        setLastName(profile.last_name ?? '');
        setPrefix(profile.prefix ?? '');
        setLoaded(true);
      })
      .catch((err: Error) => setError(err.message));
  }, [session.access_token]);

  async function handleSave() {
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const profile = await updateProfile(session.access_token, {
        first_name: firstName,
        last_name: lastName,
        prefix,
      });
      setFirstName(profile.first_name ?? '');
      setLastName(profile.last_name ?? '');
      setPrefix(profile.prefix ?? '');
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
        <h1 className="text-2xl font-semibold tracking-tight">Profile Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your own account details.</p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {loaded && (
        <>
          <div className="space-y-2">
            <label className="text-sm font-medium">Email</label>
            <p className="text-sm text-muted-foreground">{email ?? '—'}</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Position</label>
            <p className="text-sm text-muted-foreground">{position ?? '— (set by your admin)'}</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Prefix</label>
            <input
              type="text"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="e.g. Atty., Broker"
              className="h-9 w-full rounded-md border border-input px-3 text-sm"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">First name</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="h-9 w-full rounded-md border border-input px-3 text-sm"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Last name</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="h-9 w-full rounded-md border border-input px-3 text-sm"
            />
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={saving || firstName.trim() === ''}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            {saved && <span className="text-sm text-muted-foreground">Saved.</span>}
          </div>
        </>
      )}
    </div>
  );
}
