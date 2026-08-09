import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  fetchMemberPermissions,
  setMemberPermission,
  type MemberPermissions,
  type SettingKey,
} from '@/lib/settingsPermissionsApi';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type Props = {
  session: Session;
};

const SETTING_COLUMNS: { key: SettingKey; label: string }[] = [
  { key: 'sharing_templates', label: 'Sharing Templates' },
  { key: 'performance', label: 'Performance' },
  { key: 'matching', label: 'Matching' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'commission', label: 'Commission' },
  { key: 'itinerary', label: 'Itinerary' },
];

// tb-brokerage-permissions-delegation-001: admin-only sub-section (not
// rendered at all for a non-admin, see SettingsPage.tsx) -- lets an admin
// grant/revoke edit rights on the two existing Settings sub-sections, per
// member. The admin's own row is never listed: their edit rights come from
// role === 'admin', not a delegation grant, so there's nothing to toggle.
export function PermissionsSettingsPanel({ session }: Props) {
  const [members, setMembers] = useState<MemberPermissions[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  function reload() {
    fetchMemberPermissions(session.access_token)
      .then(({ members }) => setMembers(members))
      .catch((err: Error) => setError(err.message));
  }

  useEffect(reload, [session.access_token]);

  async function handleToggle(memberId: string, settingKey: SettingKey, granted: boolean) {
    setError(null);
    setPendingKey(`${memberId}:${settingKey}`);
    try {
      await setMemberPermission(session.access_token, memberId, settingKey, granted);
      setMembers(
        (current) =>
          current?.map((member) => (member.member_id === memberId ? { ...member, [settingKey]: granted } : member)) ??
          current,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Permissions</h2>
        <p className="text-sm text-muted-foreground">
          Grant a member edit rights on a specific Settings sub-section without making them an admin.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {!error && members === null && <p className="text-sm text-muted-foreground">Loading…</p>}

      {members?.length === 0 && (
        <p className="text-sm text-muted-foreground">No other members in your workspace yet.</p>
      )}

      {members && members.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                {SETTING_COLUMNS.map((column) => (
                  <TableHead key={column.key}>{column.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.member_id}>
                  <TableCell className="font-medium">
                    {member.full_name}
                    {member.handle && <span className="ml-1 text-muted-foreground">@{member.handle}</span>}
                  </TableCell>
                  {SETTING_COLUMNS.map((column) => (
                    <TableCell key={column.key}>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={member[column.key]}
                          disabled={pendingKey === `${member.member_id}:${column.key}`}
                          onChange={(e) => handleToggle(member.member_id, column.key, e.target.checked)}
                          className="h-4 w-4 rounded border-input disabled:cursor-not-allowed disabled:opacity-60"
                        />
                        {member[column.key] ? 'Can edit' : 'View only'}
                      </label>
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
