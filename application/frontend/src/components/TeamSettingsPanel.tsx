import { useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchMembers, inviteMember, removeMember, setMemberPosition, type WorkspaceMember } from '@/lib/membersApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConfirmRemoveMemberModal } from '@/components/ConfirmRemoveMemberModal';

type Props = {
  session: Session;
};

// tb-client-lifecycle-member-invite-001: admin-only sub-section (not
// rendered at all for a non-admin, see SettingsPage.tsx) -- lets an admin
// invite a teammate (always role: member, per profiles_one_admin_per_tenant)
// and remove one later. Mirrors PermissionsSettingsPanel's own admin-only
// member-list precedent.
export function TeamSettingsPanel({ session }: Props) {
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [lastInviteStatus, setLastInviteStatus] = useState<'invited' | 'added' | null>(null);

  const [pendingRemoval, setPendingRemoval] = useState<WorkspaceMember | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const [positionDrafts, setPositionDrafts] = useState<Record<string, string>>({});
  const [savingPositionId, setSavingPositionId] = useState<string | null>(null);
  const [positionError, setPositionError] = useState<string | null>(null);

  function reload() {
    fetchMembers(session.access_token)
      .then(({ members }) => {
        setMembers(members);
        setPositionDrafts(Object.fromEntries(members.map((m) => [m.id, m.position ?? ''])));
      })
      .catch((err: Error) => setListError(err.message));
  }

  useEffect(reload, [session.access_token]);

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    setInviteError(null);
    setLastInviteStatus(null);
    setInviting(true);
    try {
      const result = await inviteMember(session.access_token, { email, full_name: fullName || undefined });
      setLastInviteStatus(result.status);
      setEmail('');
      setFullName('');
      reload();
    } catch (err) {
      setInviteError((err as Error).message);
    } finally {
      setInviting(false);
    }
  }

  async function handleConfirmRemove() {
    if (!pendingRemoval) return;
    setRemoveError(null);
    setRemoving(true);
    try {
      await removeMember(session.access_token, pendingRemoval.id);
      setPendingRemoval(null);
      reload();
    } catch (err) {
      setRemoveError((err as Error).message);
    } finally {
      setRemoving(false);
    }
  }

  async function handlePositionBlur(member: WorkspaceMember) {
    const draft = positionDrafts[member.id] ?? '';
    if (draft === (member.position ?? '')) return;
    setPositionError(null);
    setSavingPositionId(member.id);
    try {
      const result = await setMemberPosition(session.access_token, member.id, draft);
      setMembers(
        (current) => current?.map((m) => (m.id === member.id ? { ...m, position: result.position } : m)) ?? current,
      );
      setPositionDrafts((current) => ({ ...current, [member.id]: result.position ?? '' }));
    } catch (err) {
      setPositionError((err as Error).message);
    } finally {
      setSavingPositionId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Team</h2>
        <p className="text-sm text-muted-foreground">Invite teammates into this workspace, or remove one.</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleInvite} className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="invite_email">Email</Label>
              <Input
                id="invite_email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="invite_full_name">Name (optional)</Label>
              <Input id="invite_full_name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <Button type="submit" disabled={inviting}>
              {inviting ? 'Inviting…' : 'Invite'}
            </Button>
          </form>
          {inviteError && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {inviteError}
            </p>
          )}
          {lastInviteStatus === 'invited' && (
            <p className="mt-3 text-sm text-muted-foreground">Invite sent — they'll receive an email to set a password.</p>
          )}
          {lastInviteStatus === 'added' && (
            <p className="mt-3 text-sm text-muted-foreground">
              Added — this email already had a Residoro account, so they can sign in with their existing password.
            </p>
          )}
        </CardContent>
      </Card>

      {listError && (
        <p role="alert" className="text-sm text-destructive">
          {listError}
        </p>
      )}

      {!listError && members === null && <p className="text-sm text-muted-foreground">Loading…</p>}

      {positionError && (
        <p role="alert" className="text-sm text-destructive">
          {positionError}
        </p>
      )}

      {members && members.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Position</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="font-medium">
                    {member.full_name ?? '—'}
                    {member.handle && <span className="ml-1 text-muted-foreground">@{member.handle}</span>}
                    {member.id === session.user.id && <span className="ml-1 text-muted-foreground">(You)</span>}
                  </TableCell>
                  <TableCell className="capitalize">{member.role}</TableCell>
                  <TableCell>
                    <Input
                      value={positionDrafts[member.id] ?? ''}
                      placeholder="e.g. Senior Agent"
                      disabled={savingPositionId === member.id}
                      onChange={(e) => setPositionDrafts((current) => ({ ...current, [member.id]: e.target.value }))}
                      onBlur={() => handlePositionBlur(member)}
                      className="h-9 max-w-48"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    {member.role !== 'admin' && (
                      <Button variant="outline" size="sm" onClick={() => setPendingRemoval(member)}>
                        Remove
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {pendingRemoval && (
        <ConfirmRemoveMemberModal
          memberName={pendingRemoval.full_name ?? pendingRemoval.handle ?? 'this member'}
          busy={removing}
          error={removeError}
          onConfirm={handleConfirmRemove}
          onCancel={() => {
            setPendingRemoval(null);
            setRemoveError(null);
          }}
        />
      )}
    </div>
  );
}
