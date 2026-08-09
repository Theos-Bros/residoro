// tb-user-profile-name-split-001: profiles.full_name was replaced by
// first_name/last_name. Every display-only consumer of a member's name
// (Team list, task assignee pickers, the Permissions grid) still expects a
// single `full_name`-shaped string in the API response it already reads --
// this helper is what each of those routes uses to compute that string
// server-side instead of reading a raw column, so none of those frontend
// components need to change.
export function formatDisplayName(firstName: string | null, lastName: string | null): string | null {
  const parts = [firstName, lastName].filter((part): part is string => !!part && part.trim() !== '');
  return parts.length > 0 ? parts.join(' ') : null;
}
