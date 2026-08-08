-- ============================================================================
-- Migration: Global search -- tsvector columns + search_global() RPC
-- Implements: tb-search-core-entities-001 (theos-registry), TB1 of
-- cap-search-001
--
-- No SECURITY DEFINER on search_global() -- Postgres's default is
-- SECURITY INVOKER, so the function runs with the calling role's own RLS.
-- Each unioned table keeps its existing RLS policy unchanged; this adds no
-- new access-control surface.
-- ============================================================================

-- Properties: title (primary) + address (secondary)
alter table public.properties add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(address, '')), 'B')
  ) stored;
create index if not exists idx_properties_search_vector
  on public.properties using gin (search_vector);

-- Contacts: name (primary) + company (secondary)
alter table public.contacts add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(company, '')), 'B')
  ) stored;
create index if not exists idx_contacts_search_vector
  on public.contacts using gin (search_vector);

-- Tasks: title only
alter table public.tasks add column if not exists search_vector tsvector
  generated always as (to_tsvector('english', coalesce(title, ''))) stored;
create index if not exists idx_tasks_search_vector
  on public.tasks using gin (search_vector);

-- Projects: name (primary) + location (secondary)
alter table public.projects add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(location, '')), 'B')
  ) stored;
create index if not exists idx_projects_search_vector
  on public.projects using gin (search_vector);

-- Listings has no own text column -- searched via its properties join at
-- query time inside search_global(), not via a listings.search_vector column.

create or replace function public.search_global(p_query text, p_limit_per_type int default 5)
returns table (entity_type text, entity_id uuid, title text, subtitle text, rank real)
language sql
stable
as $$
  with q as (select plainto_tsquery('english', p_query) as tsq),
  matches as (
    select 'property'::text as entity_type, p.id as entity_id, p.title, p.address as subtitle,
           ts_rank(p.search_vector, q.tsq) as rank
    from public.properties p, q
    where p.search_vector @@ q.tsq

    union all

    select 'listing', l.id, pr.title, pr.address, ts_rank(pr.search_vector, q.tsq)
    from public.listings l join public.properties pr on pr.id = l.property_id, q
    where pr.search_vector @@ q.tsq

    union all

    select 'contact', c.id, c.name, c.company, ts_rank(c.search_vector, q.tsq)
    from public.contacts c, q
    where c.search_vector @@ q.tsq

    union all

    select 'task', t.id, t.title, null, ts_rank(t.search_vector, q.tsq)
    from public.tasks t, q
    where t.search_vector @@ q.tsq

    union all

    select 'project', pj.id, pj.name, pj.location, ts_rank(pj.search_vector, q.tsq)
    from public.projects pj, q
    where pj.search_vector @@ q.tsq
  ),
  ranked as (
    select *, row_number() over (partition by entity_type order by rank desc) as rn
    from matches
  )
  select entity_type, entity_id, title, subtitle, rank
  from ranked
  where rn <= p_limit_per_type
  order by entity_type, rank desc
$$;

grant execute on function public.search_global(text, int) to authenticated;
