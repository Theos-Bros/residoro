-- ============================================================================
-- Migration: Task Routing -- Role-Based Default Assignee
-- Implements: tb-buyer-leads-stage-tasks-001 (theos-registry)
--
-- Extends tb-tasks-crud-001's workspace_task_routing_settings with a nullable
-- assignee_role column so a task_type's default can route to "whoever holds
-- the tenant's admin role" instead of only one hardcoded person. Scoped to
-- the single value 'admin' -- profiles.role is 'admin' | 'member' and
-- "member" doesn't name one deterministic destination. Resolution is
-- unambiguous because tb-brokerage-permissions-admin-uniqueness-001 already
-- guarantees exactly one admin-role profile per tenant.
-- ============================================================================

alter table public.workspace_task_routing_settings
  add column assignee_role text check (assignee_role in ('admin'));

-- At most one of default_assignee_id/assignee_role may be set at a time.
-- Both null means "no default configured" (unchanged meaning from
-- tb-tasks-crud-001).
alter table public.workspace_task_routing_settings
  add constraint workspace_task_routing_settings_assignee_xor
  check (not (default_assignee_id is not null and assignee_role is not null));
