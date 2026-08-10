-- ============================================================================
-- Migration: contacts.linked_handle -- contact-gated docket sharing
-- Tracer Bullet: tb-listings-co-broker-share-contact-gate-001 (theos-registry)
-- ============================================================================
--
-- tb-listings-co-broker-share-001 let a docket be shared with ANY handle on
-- the platform, no relationship check. This column is the link between a
-- sharer's own Contact row and a real platform account: POST
-- /listing-dockets now requires the resolved recipient handle to match a
-- linked_handle on one of the sharer's own contacts before the docket is
-- created (see dockets.ts). The @handle field itself is unchanged -- this is
-- an additional gate, not a replacement for it.

alter table public.contacts add column if not exists linked_handle text;

comment on column public.contacts.linked_handle is
  'Optional link to a real platform account handle (profiles.handle), set via '
  'PATCH /contacts/:id after validating the handle resolves to a real profile -- '
  'same lookup POST /listing-dockets already does. Case-normalized to lowercase '
  'at write time, matching dockets.ts''s normalizedHandle. Existence of a row '
  'here with a matching linked_handle is what POST /listing-dockets checks '
  'before allowing a docket share (tb-listings-co-broker-share-contact-gate-001).';

-- Case-normalized, per-tenant: two contacts in the same tenant can''t link the
-- same handle (would make the "which contact is this?" question ambiguous),
-- but the same handle can be linked by contacts in different tenants (e.g.
-- two different brokerages both have "that person" as a contact).
create unique index if not exists contacts_tenant_linked_handle_key
  on public.contacts (tenant_id, lower(linked_handle))
  where linked_handle is not null;

-- 20260810240000_tier1_grant_lockdown.sql revoked all default privileges on
-- public.contacts and re-granted only an explicit column list for
-- insert/update -- a column added after that migration isn't covered by
-- those column lists automatically, so it needs its own explicit grant or
-- PATCH /contacts/:id would silently fail to persist it under the scoped
-- (authenticated) client despite the route-level code allowing it.
grant update (linked_handle) on public.contacts to authenticated;
