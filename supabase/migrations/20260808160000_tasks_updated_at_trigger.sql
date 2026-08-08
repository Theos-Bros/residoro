-- ============================================================================
-- Migration: Add the missing set_updated_at trigger to tasks
--
-- tasks.updated_at has had a `default now()` since tb-tasks-crud-001
-- (20260728200000_tasks_schema.sql) but was never wired to the
-- public.set_updated_at() trigger every other table in this codebase uses
-- (contacts, listings, properties, projects, transactions, etc.) -- an
-- oversight in that migration, not a deliberate choice. PATCH /tasks/:id
-- only ever updates the fields the caller actually changed (status,
-- assignee_id, ...), never updated_at itself, so marking a task done left
-- updated_at frozen at creation time. Discovered live: TasksPage.tsx's
-- "Completed This Week" stat filters on
-- `status = 'done' AND updated_at within the last 7 days`, so a task
-- created more than a week ago and completed today silently never counted.
-- ============================================================================

create trigger trg_tasks_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();
