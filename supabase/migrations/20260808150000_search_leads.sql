-- ============================================================================
-- Migration: Global search -- add Inquiries + Leads (buyer_requirements)
-- Corrects tb-search-core-entities-001: the Leads pipeline (inquiries,
-- buyer_requirements -- cap-buyer-leads-001) was overlooked during TB1's
-- entity survey, discovered live when the user searched a lead's name and
-- got no dedicated result.
--
-- inquiries gets its own search_vector (buyer_name -- the only identifying
-- text field on the row itself). buyer_requirements has no name field of
-- its own (identity lives on the linked contact) -- searched via a join to
-- contacts.search_vector, same pattern as listings -> properties.
-- ============================================================================

alter table public.inquiries add column if not exists search_vector tsvector
  generated always as (to_tsvector('english', coalesce(buyer_name, ''))) stored;
create index if not exists idx_inquiries_search_vector
  on public.inquiries using gin (search_vector);

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

    select 'lead', br.id, c.name, br.stage, ts_rank(c.search_vector, q.tsq)
    from public.buyer_requirements br join public.contacts c on c.id = br.contact_id, q
    where c.search_vector @@ q.tsq

    union all

    select 'inquiry', i.id, i.buyer_name, i.stage, ts_rank(i.search_vector, q.tsq)
    from public.inquiries i, q
    where i.search_vector @@ q.tsq

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
