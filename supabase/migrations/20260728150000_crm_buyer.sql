-- tb-crm-buyer-001 (cap-crm-001 Milestone 3)
-- Buyer as a formal relationship on listings, resolving cap-crm-001's Decision #2:
-- Seller needs no new field (properties.owner_id already covers it); Buyer attaches
-- directly to the listing, required exactly on the transition to status='sold'
-- (enforced in the route handler, not a column constraint -- every other status
-- legitimately has buyer_contact_id = null).

alter table public.listings add column buyer_contact_id uuid references public.contacts(id);

create index if not exists idx_listings_buyer_contact_id
  on public.listings (buyer_contact_id) where buyer_contact_id is not null;
