import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { createProperty, createListing, type PropertyType, type OwnerType } from '@/lib/listingsApi';
import { fetchDevelopers, fetchProjects, type Developer, type Project } from '@/lib/projectsApi';
import { fetchContacts, type Contact } from '@/lib/contactsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent } from '@/components/ui/card';

type Props = {
  session: Session;
};

const selectClass = 'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm';

const PROPERTY_TYPES: PropertyType[] = [
  'condo_unit',
  'house_and_lot',
  'lot_only',
  'townhouse',
  'commercial',
  'warehouse',
  'agricultural',
  'industrial',
];

const OWNER_TYPES: OwnerType[] = ['developer', 'individual', 'company'];

// tb-listings-new-property-001: the "I just got a new listing" moment for a
// property that isn't in residoro yet -- creates a properties row and a
// listings row together in one submit. Reuses POST /listings unchanged
// against the newly-created property_id; the listing fields below mirror
// CreateListingForm's exactly.
//
// tb-properties-owner-linking-001: an Owner picker is now offered, sourced
// from `developers` or `contacts` depending on owner_type (mirrors the
// Project picker's lazy-fetch-on-owner_type-change pattern). Still optional
// -- omitting it inserts owner_id = null, same as before this tracer bullet.
export function NewPropertyListingForm({ session }: Props) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<PropertyType>('condo_unit');
  const [ownerType, setOwnerType] = useState<OwnerType>('individual');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [province, setProvince] = useState('');
  const [askPrice, setAskPrice] = useState('');

  // tb-properties-project-001: a Project picker only makes sense for
  // developer-owned properties -- resale properties (individual/company)
  // never get a project_id, enforced again server-side (see POST
  // /properties). Loaded lazily only when ownerType becomes 'developer' so a
  // resale-only session never pays for the fetch.
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectId, setProjectId] = useState<string>('');

  // tb-properties-owner-linking-001: developers/contacts loaded lazily,
  // matching the Project picker's own lazy-fetch pattern -- developers when
  // ownerType is 'developer', contacts when it's 'individual'/'company'.
  // ownerId resets on ownerType change so a stale developer id can't leak
  // into a contact-owned property or vice versa.
  const [developers, setDevelopers] = useState<Developer[] | null>(null);
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [ownerId, setOwnerId] = useState<string>('');

  const [listingType, setListingType] = useState<'sale' | 'rent'>('sale');
  const [price, setPrice] = useState('');
  const [exclusivity, setExclusivity] = useState<'exclusive' | 'open'>('open');
  const [authorityStartsAt, setAuthorityStartsAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [authorityExpiresAt, setAuthorityExpiresAt] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (ownerType !== 'developer' || projects !== null) return;
    let cancelled = false;

    fetchProjects(session.access_token)
      .then(({ projects }) => {
        if (!cancelled) setProjects(projects);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [ownerType, projects, session.access_token]);

  useEffect(() => {
    setOwnerId('');
  }, [ownerType]);

  useEffect(() => {
    if (ownerType !== 'developer' || developers !== null) return;
    let cancelled = false;

    fetchDevelopers(session.access_token)
      .then(({ developers }) => {
        if (!cancelled) setDevelopers(developers);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [ownerType, developers, session.access_token]);

  useEffect(() => {
    if (ownerType === 'developer' || contacts !== null) return;
    let cancelled = false;

    fetchContacts(session.access_token)
      .then(({ contacts }) => {
        if (!cancelled) setContacts(contacts);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [ownerType, contacts, session.access_token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Title is required.');
      return;
    }

    const numericPrice = Number(price);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      setError('Listing price must be a positive number.');
      return;
    }

    const numericAskPrice = askPrice ? Number(askPrice) : undefined;
    if (askPrice && (!Number.isFinite(numericAskPrice) || (numericAskPrice as number) < 0)) {
      setError("Owner's ask price must be a non-negative number.");
      return;
    }

    setSubmitting(true);
    try {
      const property = await createProperty(session.access_token, {
        title: title.trim(),
        type,
        owner_type: ownerType,
        address: address || undefined,
        city: city || undefined,
        province: province || undefined,
        price: numericAskPrice,
        project_id: ownerType === 'developer' && projectId ? projectId : undefined,
        owner_id: ownerId || undefined,
      });

      await createListing(session.access_token, {
        property_id: property.id,
        listing_type: listingType,
        price: numericPrice,
        exclusivity,
        authority_starts_at: authorityStartsAt ? new Date(authorityStartsAt).toISOString() : undefined,
        authority_expires_at: authorityExpiresAt ? new Date(authorityExpiresAt).toISOString() : null,
      });

      navigate('/properties', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Add a new listing</h1>
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="title">Property title</Label>
              <Input id="title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="type">Property type</Label>
              <select
                id="type"
                value={type}
                onChange={(e) => setType(e.target.value as PropertyType)}
                className={selectClass}
              >
                {PROPERTY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="owner_type">Owner type</Label>
              <select
                id="owner_type"
                value={ownerType}
                onChange={(e) => setOwnerType(e.target.value as OwnerType)}
                className={selectClass}
              >
                {OWNER_TYPES.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="owner">
                {ownerType === 'developer' ? 'Developer (optional)' : 'Owner contact (optional)'}
              </Label>
              <select
                id="owner"
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                className={selectClass}
              >
                <option value="">— Unspecified —</option>
                {ownerType === 'developer'
                  ? developers?.map((developer) => (
                      <option key={developer.id} value={developer.id}>
                        {developer.name}
                      </option>
                    ))
                  : contacts?.map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contact.name}
                        {contact.company ? ` (${contact.company})` : ''}
                      </option>
                    ))}
              </select>
            </div>
            {ownerType === 'developer' && (
              <div className="space-y-1.5">
                <Label htmlFor="project">Project (optional)</Label>
                <select
                  id="project"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className={selectClass}
                >
                  <option value="">— None yet —</option>
                  {projects?.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="address">Address (optional)</Label>
              <Input id="address" type="text" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="city">City (optional)</Label>
                <Input id="city" type="text" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="province">Province (optional)</Label>
                <Input id="province" type="text" value={province} onChange={(e) => setProvince(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ask_price">Owner&apos;s ask price (optional, PHP)</Label>
              <Input
                id="ask_price"
                type="number"
                min="0"
                step="0.01"
                value={askPrice}
                onChange={(e) => setAskPrice(e.target.value)}
              />
            </div>

            <Separator className="my-2" />
            <h2 className="text-lg font-semibold">Listing details</h2>

            <div className="space-y-1.5">
              <Label htmlFor="listing_type">Listing type</Label>
              <select
                id="listing_type"
                value={listingType}
                onChange={(e) => setListingType(e.target.value as 'sale' | 'rent')}
                className={selectClass}
              >
                <option value="sale">Sale</option>
                <option value="rent">Rent</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="price">Price (PHP)</Label>
              <Input
                id="price"
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exclusivity">Exclusivity</Label>
              <select
                id="exclusivity"
                value={exclusivity}
                onChange={(e) => setExclusivity(e.target.value as 'exclusive' | 'open')}
                className={selectClass}
              >
                <option value="open">Open (non-exclusive)</option>
                <option value="exclusive">Exclusive</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="authority_starts_at">Authority to Sell/Lease starts</Label>
                <Input
                  id="authority_starts_at"
                  type="date"
                  value={authorityStartsAt}
                  onChange={(e) => setAuthorityStartsAt(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="authority_expires_at">Ends (optional)</Label>
                <Input
                  id="authority_expires_at"
                  type="date"
                  value={authorityExpiresAt}
                  onChange={(e) => setAuthorityExpiresAt(e.target.value)}
                />
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'Creating…' : 'Add listing'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
