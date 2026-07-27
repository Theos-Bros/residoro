-- tb-crm-developer-consolidation-001 (cap-crm-001 Milestone 1)
-- Retires the standalone `developers` placeholder table (DS-007) by folding it into
-- `contacts` via a new `is_company` flag -- cap-crm-001's Company concept. Preserves
-- original developer ids so projects.developer_id values don't need updating, only the
-- FK's target table.
--
-- contact_info's JSON shape is not decomposed into contacts' discrete email/phone/notes
-- columns here -- confirmed live 2026-07-28 that every existing developers row (there are
-- currently zero) has no such data to lose, and no UI path ever wrote real contact_info
-- values. A future migration reusing this pattern against a database with real contact_info
-- data would need to add that decomposition explicitly first.

alter table public.contacts add column is_company boolean not null default false;

create index if not exists idx_contacts_is_company
  on public.contacts (tenant_id, is_company) where is_company = true;

insert into public.contacts (id, tenant_id, name, type, is_company, created_by, created_at, updated_at)
select id, tenant_id, name, 'developer', true, created_by, created_at, updated_at
from public.developers;

alter table public.projects drop constraint projects_developer_id_fkey;
alter table public.projects add constraint projects_developer_id_fkey
  foreign key (developer_id) references public.contacts(id);

drop table public.developers;
