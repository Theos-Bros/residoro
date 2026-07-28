-- ============================================================================
-- Migration: Tasks -- Records, Routing Settings
-- Implements: tb-tasks-crud-001 (theos-registry), TB1 of cap-tasks-001
--
-- entity_type/entity_id is a deliberate generic polymorphic link (no FK --
-- cap-tasks-001 Decision #2) so any future entity in residoro can be linked
-- without a schema change here. workspace_task_routing_settings mirrors
-- workspace_matching_settings' delegated-settings shape (learn-delegated-
-- permissions-rls-001) but keyed per (tenant, task_type) rather than one row
-- per tenant, since routing config is opt-in per task_type, not mandatory.
-- ============================================================================

create table public.tasks (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.workspaces(id),

  title             text not null,
  description       text,
  status            text not null default 'open' check (status in ('open', 'in_progress', 'done')),
  due_date          date,

  assignee_id       uuid references public.profiles(id),

  entity_type       text,
  entity_id         uuid,

  task_type         text not null default 'manual',

  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on column public.tasks.entity_type is
  'Generic polymorphic link (e.g. ''buyer_requirement''); no FK by design -- '
  'cap-tasks-001 Decision #2. Null when a task is standalone.';

create index idx_tasks_tenant_id on public.tasks (tenant_id);
create index idx_tasks_entity on public.tasks (entity_type, entity_id);
create index idx_tasks_assignee on public.tasks (assignee_id);

alter table public.tasks enable row level security;

create policy tasks_select_tenant on public.tasks
  for select using (tenant_id = (select public.current_tenant_id()));
create policy tasks_insert_tenant on public.tasks
  for insert with check (tenant_id = (select public.current_tenant_id()));
create policy tasks_update_tenant on public.tasks
  for update using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
-- Admin-only delete, matching every other entity's RLS shape in this
-- codebase (contacts, buyer_requirements, inquiries all use *_delete_admin).
create policy tasks_delete_admin on public.tasks
  for delete using (tenant_id = (select public.current_tenant_id()) and public.current_role() = 'admin');

grant select, insert, update, delete on public.tasks to authenticated;
grant all on public.tasks to service_role;

-- Routing config: one row per (tenant, task_type). No row for a given
-- task_type means "no default, falls back to unassigned" -- opt-in, not
-- mandatory coverage.
create table public.workspace_task_routing_settings (
  tenant_id           uuid not null references public.workspaces(id),
  task_type           text not null,
  default_assignee_id uuid references public.profiles(id),
  primary key (tenant_id, task_type)
);

alter table public.workspace_task_routing_settings enable row level security;

create policy task_routing_select_tenant on public.workspace_task_routing_settings
  for select using (tenant_id = (select public.current_tenant_id()));
create policy task_routing_write_delegated on public.workspace_task_routing_settings
  for all using (
    tenant_id = (select public.current_tenant_id())
    and public.has_settings_delegation('tasks')
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and public.has_settings_delegation('tasks')
  );

grant select, insert, update, delete on public.workspace_task_routing_settings to authenticated;
grant all on public.workspace_task_routing_settings to service_role;

-- Widen settings_edit_delegations' setting_key check to add 'tasks', same
-- pattern tb-buyer-leads-matching-001 used to add 'matching'.
alter table public.settings_edit_delegations
  drop constraint settings_edit_delegations_setting_key_check;

alter table public.settings_edit_delegations
  add constraint settings_edit_delegations_setting_key_check
  check (setting_key in ('sharing_templates', 'performance', 'matching', 'tasks'));
