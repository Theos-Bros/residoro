-- tb-migration-rollback-window-001: per-brokerage configurable rollback
-- window, replacing the fixed 24h ROLLBACK_WINDOW_MS constant read by
-- tb-migration-rollback-001's import-batch-creation step. Default 24
-- preserves today's behavior for every existing and newly enrolled
-- workspace unless an operator explicitly sets a different value.
alter table public.workspaces
  add column if not exists rollback_window_hours integer not null default 24;

alter table public.workspaces
  add constraint workspaces_rollback_window_hours_positive
  check (rollback_window_hours > 0);

comment on column public.workspaces.rollback_window_hours is
  'Per-brokerage override of the default 24h rollback window (tb-migration-rollback-001). '
  'Read once at import-batch-creation time to compute that batch''s rollback_deadline -- '
  'changing this value does not retroactively affect batches already created. '
  'Operator-set only, default 24, per cap-migration-001 Decision #1 and '
  'tb-migration-rollback-window-001.';
