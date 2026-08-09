-- ============================================================================
-- Migration: Global search -- add Transactions (viewings, offers, contracts,
-- closings) via listing/contact join
-- Implements: tb-search-transactions-001 (theos-registry), TB2 of
-- cap-search-001
--
-- None of the four transaction tables has a text field of its own -- each is
-- indexed by joining through listing_id (-> properties.search_vector) and
-- buyer_requirement_id -> buyer_requirements.contact_id (-> contacts.
-- search_vector), the same join-through treatment TB1 already gave Listings
-- (via properties) and Leads (via contacts). No new search_vector columns,
-- no SECURITY DEFINER -- same invoker-mode RLS posture as every other branch.
--
-- title is always the linked property's title (same anchor identity as the
-- 'listing' branch) so a transaction result reads consistently regardless of
-- whether it matched on the property side or the buyer side. subtitle uses
-- each table's own status-ish field (outcome / status / signing_status) --
-- the one piece of information a bare property title/address can't already
-- tell you -- except closings, which has no status field of its own, so it
-- falls back to the property address per this tracer bullet's own Context
-- notes.
-- ============================================================================

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

    union all

    select 'viewing', v.id, pr.title, v.outcome,
           greatest(ts_rank(pr.search_vector, q.tsq), ts_rank(c.search_vector, q.tsq))
    from public.viewings v
      join public.listings l on l.id = v.listing_id
      join public.properties pr on pr.id = l.property_id
      join public.buyer_requirements br on br.id = v.buyer_requirement_id
      join public.contacts c on c.id = br.contact_id, q
    where pr.search_vector @@ q.tsq or c.search_vector @@ q.tsq

    union all

    select 'offer', o.id, pr.title, o.status,
           greatest(ts_rank(pr.search_vector, q.tsq), ts_rank(c.search_vector, q.tsq))
    from public.offers o
      join public.listings l on l.id = o.listing_id
      join public.properties pr on pr.id = l.property_id
      join public.buyer_requirements br on br.id = o.buyer_requirement_id
      join public.contacts c on c.id = br.contact_id, q
    where pr.search_vector @@ q.tsq or c.search_vector @@ q.tsq

    union all

    select 'contract', ct.id, pr.title, ct.signing_status,
           greatest(ts_rank(pr.search_vector, q.tsq), ts_rank(c.search_vector, q.tsq))
    from public.contracts ct
      join public.listings l on l.id = ct.listing_id
      join public.properties pr on pr.id = l.property_id
      join public.buyer_requirements br on br.id = ct.buyer_requirement_id
      join public.contacts c on c.id = br.contact_id, q
    where pr.search_vector @@ q.tsq or c.search_vector @@ q.tsq

    union all

    select 'closing', cl.id, pr.title, pr.address,
           greatest(ts_rank(pr.search_vector, q.tsq), ts_rank(c.search_vector, q.tsq))
    from public.closings cl
      join public.listings l on l.id = cl.listing_id
      join public.properties pr on pr.id = l.property_id
      join public.buyer_requirements br on br.id = cl.buyer_requirement_id
      join public.contacts c on c.id = br.contact_id, q
    where pr.search_vector @@ q.tsq or c.search_vector @@ q.tsq
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
