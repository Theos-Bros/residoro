-- ============================================================================
-- Migration: Distribution -- Audience-Scoped Share Text
-- Implements: tb-distribution-share-text-001 (theos-registry)
-- Adds a free-text commission field agents can reference in the co-broker
-- template, and two workspace-level (tenant-wide) rich-text templates the
-- brokerage authors once. No new tables -- both are simple additive columns
-- on already tenant-scoped tables, so no RLS changes are needed.
-- ============================================================================

alter table public.listings add column if not exists commission_note text;

comment on column public.listings.commission_note is
  'Free-text, agent-entered -- referenced by the co-broker share-text template '
  '(tb-distribution-share-text-001). Not a computed commission/payout value.';

alter table public.workspaces add column if not exists public_share_template text;
alter table public.workspaces add column if not exists co_broker_share_template text;

comment on column public.workspaces.public_share_template is
  'Brokerage-authored rich text (HTML) with {{merge_field}} placeholders, '
  'used to generate Public-audience share text (tb-distribution-share-text-001). '
  'Never includes commission_note or owner info -- those are not in the '
  'public merge-field set.';
comment on column public.workspaces.co_broker_share_template is
  'Brokerage-authored rich text (HTML) with {{merge_field}} placeholders, '
  'used to generate Co-broker-audience share text. May reference '
  '{{commission_note}}. The Internal audience has no template -- it is a '
  'fixed full-detail format built in application code, not stored here.';
