import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { fetchProperty, fetchPropertyMedia, type PropertyDetail, type PropertyMedia } from '@/lib/propertyMediaApi';
import { fetchPropertyDocuments, type PropertyDocument } from '@/lib/propertyDocumentsApi';
import {
  updatePropertyVerification,
  updateProperty,
  PROPERTY_STATUS_VARIANT,
  VERIFICATION_STATUSES,
  PROPERTY_STATUSES,
  type VerificationStatus,
  type PropertyStatus,
  type OwnerType,
} from '@/lib/listingsApi';
import { fetchDevelopers, type Developer } from '@/lib/projectsApi';
import { fetchContacts, type Contact } from '@/lib/contactsApi';
import { useWorkspaceStatus } from '@/hooks/useWorkspaceStatus';
import { PropertyPhotoGallery } from '@/components/PropertyPhotoGallery';
import { PropertyDocumentsSection } from '@/components/PropertyDocumentsSection';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';

type Props = {
  session: Session;
};

const verificationSelectClass =
  'h-7 rounded-md border border-input bg-card px-2 text-xs shadow-sm';

const selectClass = 'flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm';

// tb-design-system-states-mobile-001: design doc section 06 specs 3 visual
// states for an album link's reachability -- reachable/restricted/not-yet-
// checked. property_media (see propertyMediaApi.ts's PropertyMedia type and
// this repo's 20260727150000_property_media_external_links.sql migration)
// has no reachability/last-checked column at all -- no backend job ever
// probes external_url. Per this tracer bullet's explicit instructions, real
// reachability *checking* (an HTTP request out to Google Photos/Drive) is
// out of scope for a design-only tracer bullet, so every album renders as
// "not checked yet" -- this is a genuine data-model gap, not a shortcut:
// flagged here, and again in this tracer bullet's final report.
type AlbumLinkStatus = 'reachable' | 'restricted' | 'not_checked';

function AlbumLinkStatusCard({ status, photoCount }: { status: AlbumLinkStatus; photoCount: number }) {
  if (status === 'reachable') {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-[#D3E5D6] bg-card px-3.5 py-2.5 text-sm dark:border-[#2E4434]">
        <span className="h-2 w-2 shrink-0 rounded-full bg-[#2F6B3A] dark:bg-[#7FBE8C]" />
        <span className="text-muted-foreground">
          Link reachable · {photoCount} photo{photoCount === 1 ? '' : 's'} · anyone with the link can view
        </span>
      </div>
    );
  }
  if (status === 'restricted') {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-[#F2D8D4] bg-[#FBECEA] px-3.5 py-2.5 text-sm text-[#9B3227] dark:border-[#4a2320] dark:bg-[#2e1613] dark:text-[#e5877a]">
        <span className="h-2 w-2 shrink-0 rounded-full bg-[#9B3227] dark:bg-[#e5877a]" />
        <span>
          Restricted link — clients would hit a sign-in wall. Set the album to "anyone with the link" before
          sharing.
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2.5 rounded-lg border bg-card px-3.5 py-2.5 text-sm">
      <span className="h-2 w-2 shrink-0 rounded-full bg-tertiary-foreground/40" />
      <span className="text-muted-foreground">
        Not checked yet — {photoCount} photo{photoCount === 1 ? '' : 's'} linked. Residoro doesn't verify link
        reachability today.
      </span>
    </div>
  );
}

const OWNER_TYPES: OwnerType[] = ['developer', 'individual', 'company'];

type EditFormState = {
  title: string;
  address: string;
  city: string;
  province: string;
  floor_area_sqm: string;
  lot_area_sqm: string;
  bedrooms: string;
  bathrooms: string;
  parking_slots: string;
  price: string;
  status: PropertyStatus;
  lease_monthly_rent: string;
  lease_term_months: string;
  owner_type: OwnerType;
  owner_id: string;
};

function toFormState(property: PropertyDetail): EditFormState {
  return {
    title: property.title,
    address: property.address ?? '',
    city: property.city ?? '',
    province: property.province ?? '',
    floor_area_sqm: property.floor_area_sqm?.toString() ?? '',
    lot_area_sqm: property.lot_area_sqm?.toString() ?? '',
    bedrooms: property.bedrooms?.toString() ?? '',
    bathrooms: property.bathrooms?.toString() ?? '',
    parking_slots: property.parking_slots?.toString() ?? '',
    price: property.price?.toString() ?? '',
    status: property.status as PropertyStatus,
    lease_monthly_rent: property.lease_monthly_rent?.toString() ?? '',
    lease_term_months: property.lease_term_months?.toString() ?? '',
    owner_type: property.owner_type as OwnerType,
    owner_id: property.owner_id ?? '',
  };
}

function formatPrice(value: number | null, currency: string): string {
  return value === null ? '—' : `${currency} ${value.toLocaleString()}`;
}

// tb-properties-photos-001: no single-property view existed before this --
// only PropertiesListPage (a list) and PropertyCard (unrelated, migration-
// preview only).
//
// tb-properties-edit-001: the general edit form below closes the gap the
// original comment here used to flag ("not a full edit experience") --
// general fields (title/location/specs/price/status) are open to any tenant
// user, matching PATCH /properties/:id's own lack of a role check; ownership
// (owner_type/owner_id) is only rendered for admins, mirroring the
// verification-status control's existing isAdmin gate on this same page.
export function PropertyDetailPage({ session }: Props) {
  const { id } = useParams<{ id: string }>();
  const [property, setProperty] = useState<PropertyDetail | null>(null);
  const [media, setMedia] = useState<PropertyMedia[] | null>(null);
  const [documents, setDocuments] = useState<PropertyDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { status: workspaceStatus } = useWorkspaceStatus(session);
  const isAdmin = workspaceStatus?.role === 'admin';

  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<EditFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [developers, setDevelopers] = useState<Developer[] | null>(null);
  const [contacts, setContacts] = useState<Contact[] | null>(null);

  async function handleVerificationChange(verificationStatus: VerificationStatus) {
    if (!id) return;
    setError(null);
    try {
      await updatePropertyVerification(session.access_token, id, verificationStatus);
      const refreshed = await fetchProperty(session.access_token, id);
      setProperty(refreshed);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function startEditing() {
    if (!property) return;
    setForm(toFormState(property));
    setSaveError(null);
    setIsEditing(true);
  }

  function cancelEditing() {
    setIsEditing(false);
    setForm(null);
    setSaveError(null);
  }

  function updateForm(patch: Partial<EditFormState>) {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  // tb-properties-owner-linking-001's own lazy-fetch-on-owner_type pattern,
  // reused here: only loaded once editing starts and only for the isAdmin
  // branch that actually renders the ownership picker.
  useEffect(() => {
    if (!isEditing || !isAdmin || !form) return;
    if (form.owner_type === 'developer') {
      if (developers !== null) return;
      let cancelled = false;
      fetchDevelopers(session.access_token)
        .then(({ developers }) => {
          if (!cancelled) setDevelopers(developers);
        })
        .catch((err: Error) => {
          if (!cancelled) setSaveError(err.message);
        });
      return () => {
        cancelled = true;
      };
    } else {
      if (contacts !== null) return;
      let cancelled = false;
      fetchContacts(session.access_token)
        .then(({ contacts }) => {
          if (!cancelled) setContacts(contacts);
        })
        .catch((err: Error) => {
          if (!cancelled) setSaveError(err.message);
        });
      return () => {
        cancelled = true;
      };
    }
  }, [isEditing, isAdmin, form?.owner_type, developers, contacts, session.access_token]);

  async function handleEditSubmit(e: FormEvent) {
    e.preventDefault();
    if (!id || !form) return;
    setSaveError(null);

    if (!form.title.trim()) {
      setSaveError('Title is required.');
      return;
    }

    const numericPatch: Record<string, number> = {};
    for (const [field, raw] of Object.entries({
      floor_area_sqm: form.floor_area_sqm,
      lot_area_sqm: form.lot_area_sqm,
      bedrooms: form.bedrooms,
      bathrooms: form.bathrooms,
      parking_slots: form.parking_slots,
      price: form.price,
    })) {
      if (raw.trim() === '') continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) {
        setSaveError(`${field.replace(/_/g, ' ')} must be a non-negative number.`);
        return;
      }
      numericPatch[field] = value;
    }

    // tb-properties-unit-leasing-001: lease_monthly_rent/lease_term_months
    // are required together, only when the form's status is 'leased' --
    // mirrors PATCH /properties/:id's own validation so the error surfaces
    // before the round-trip, not just after a rejected request.
    let leasePatch: { lease_monthly_rent?: number; lease_term_months?: number } = {};
    if (form.status === 'leased') {
      const rentRaw = form.lease_monthly_rent.trim();
      const termRaw = form.lease_term_months.trim();
      if (!rentRaw || !termRaw) {
        setSaveError('Lease monthly rent and lease term (months) are both required when status is Leased.');
        return;
      }
      const rent = Number(rentRaw);
      if (!Number.isFinite(rent) || rent <= 0) {
        setSaveError('Lease monthly rent must be a positive number.');
        return;
      }
      const term = Number(termRaw);
      if (!Number.isInteger(term) || term <= 0) {
        setSaveError('Lease term (months) must be a positive whole number.');
        return;
      }
      leasePatch = { lease_monthly_rent: rent, lease_term_months: term };
    }

    setSaving(true);
    try {
      const ownershipChanged = isAdmin && property && form.owner_type !== property.owner_type;
      const ownerIdChanged = isAdmin && property && form.owner_id !== (property.owner_id ?? '');
      await updateProperty(session.access_token, id, {
        title: form.title.trim(),
        address: form.address,
        city: form.city,
        province: form.province,
        status: form.status,
        price_currency: property?.price_currency,
        ...numericPatch,
        ...leasePatch,
        ...(isAdmin && (ownershipChanged || ownerIdChanged)
          ? { owner_type: form.owner_type, owner_id: form.owner_id || null }
          : {}),
      });
      const refreshed = await fetchProperty(session.access_token, id);
      setProperty(refreshed);
      setIsEditing(false);
      setForm(null);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    Promise.all([
      fetchProperty(session.access_token, id),
      fetchPropertyMedia(session.access_token, id),
      fetchPropertyDocuments(session.access_token, id),
    ])
      .then(([propertyResult, mediaResult, documentsResult]) => {
        if (cancelled) return;
        setProperty(propertyResult);
        setMedia(mediaResult.media);
        setDocuments(documentsResult.documents);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [id, session.access_token]);

  if (!id) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="secondary" size="sm">
          <Link to="/properties">← Back to properties</Link>
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!error && property === null && <p className="text-sm text-muted-foreground">Loading…</p>}

      {property && (
        <>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{property.title}</h1>
              <Badge variant={PROPERTY_STATUS_VARIANT[property.status as keyof typeof PROPERTY_STATUS_VARIANT] ?? 'neutral'}>
                {property.status}
              </Badge>
              {!isEditing && (
                <Button variant="outline" size="sm" onClick={startEditing}>
                  Edit
                </Button>
              )}
              {isAdmin ? (
                <select
                  aria-label={`Verification status for ${property.title}`}
                  value={property.verification_status}
                  onChange={(e) => handleVerificationChange(e.target.value as VerificationStatus)}
                  className={verificationSelectClass}
                >
                  {VERIFICATION_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              ) : (
                <Badge variant="neutral">{property.verification_status}</Badge>
              )}
            </div>
            <p className="max-w-xl text-sm text-muted-foreground">
              The master record for this unit. Price and status changes here propagate to every live
              listing and shared docket within a minute.
            </p>
            <p className="font-mono text-lg font-medium">{formatPrice(property.price, property.price_currency)}</p>
            {property.status === 'leased' && (
              <p className="text-sm text-tertiary-foreground">
                Leased: <span className="font-mono">{formatPrice(property.lease_monthly_rent, property.price_currency)}</span>/mo for{' '}
                {property.lease_term_months ?? '—'} months
              </p>
            )}
            <p className="text-sm text-tertiary-foreground">
              {[property.address, property.city, property.province].filter(Boolean).join(', ') || '—'}
            </p>
            {property.project_name && (
              <p className="text-sm text-tertiary-foreground">
                Part of{' '}
                <Link to={`/projects/${property.project_id}`} className="text-accent-foreground hover:underline">
                  {property.project_name}
                </Link>
              </p>
            )}
          </div>

          {isEditing && form && (
            <Card>
              <CardContent className="pt-6">
                <form onSubmit={handleEditSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="edit_title">Title</Label>
                    <Input
                      id="edit_title"
                      type="text"
                      value={form.title}
                      onChange={(e) => updateForm({ title: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit_address">Address</Label>
                    <Input
                      id="edit_address"
                      type="text"
                      value={form.address}
                      onChange={(e) => updateForm({ address: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="edit_city">City</Label>
                      <Input
                        id="edit_city"
                        type="text"
                        value={form.city}
                        onChange={(e) => updateForm({ city: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit_province">Province</Label>
                      <Input
                        id="edit_province"
                        type="text"
                        value={form.province}
                        onChange={(e) => updateForm({ province: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="edit_floor_area">Floor area (sqm)</Label>
                      <Input
                        id="edit_floor_area"
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.floor_area_sqm}
                        onChange={(e) => updateForm({ floor_area_sqm: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit_lot_area">Lot area (sqm)</Label>
                      <Input
                        id="edit_lot_area"
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.lot_area_sqm}
                        onChange={(e) => updateForm({ lot_area_sqm: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="edit_bedrooms">Bedrooms</Label>
                      <Input
                        id="edit_bedrooms"
                        type="number"
                        min="0"
                        value={form.bedrooms}
                        onChange={(e) => updateForm({ bedrooms: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit_bathrooms">Bathrooms</Label>
                      <Input
                        id="edit_bathrooms"
                        type="number"
                        min="0"
                        value={form.bathrooms}
                        onChange={(e) => updateForm({ bathrooms: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit_parking">Parking slots</Label>
                      <Input
                        id="edit_parking"
                        type="number"
                        min="0"
                        value={form.parking_slots}
                        onChange={(e) => updateForm({ parking_slots: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit_price">
                      Price ({property.price_currency})
                    </Label>
                    <Input
                      id="edit_price"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.price}
                      onChange={(e) => updateForm({ price: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit_status">Status</Label>
                    <select
                      id="edit_status"
                      value={form.status}
                      onChange={(e) => updateForm({ status: e.target.value as PropertyStatus })}
                      className={selectClass}
                    >
                      {PROPERTY_STATUSES.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </div>

                  {form.status === 'leased' && (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="edit_lease_monthly_rent">
                          Lease monthly rent ({property.price_currency})
                        </Label>
                        <Input
                          id="edit_lease_monthly_rent"
                          type="number"
                          min="0"
                          step="0.01"
                          value={form.lease_monthly_rent}
                          onChange={(e) => updateForm({ lease_monthly_rent: e.target.value })}
                          required
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="edit_lease_term_months">Lease term (months)</Label>
                        <Input
                          id="edit_lease_term_months"
                          type="number"
                          min="1"
                          step="1"
                          value={form.lease_term_months}
                          onChange={(e) => updateForm({ lease_term_months: e.target.value })}
                          required
                        />
                      </div>
                    </div>
                  )}

                  {isAdmin && (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="edit_owner_type">Owner type (admin only)</Label>
                        <select
                          id="edit_owner_type"
                          value={form.owner_type}
                          onChange={(e) =>
                            updateForm({ owner_type: e.target.value as OwnerType, owner_id: '' })
                          }
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
                        <Label htmlFor="edit_owner">
                          {form.owner_type === 'developer' ? 'Developer' : 'Owner contact'}
                        </Label>
                        <select
                          id="edit_owner"
                          value={form.owner_id}
                          onChange={(e) => updateForm({ owner_id: e.target.value })}
                          className={selectClass}
                        >
                          <option value="">— Unspecified —</option>
                          {form.owner_type === 'developer'
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
                    </>
                  )}

                  {saveError && <p className="text-sm text-destructive">{saveError}</p>}
                  <div className="flex gap-2">
                    <Button type="submit" disabled={saving}>
                      {saving ? 'Saving…' : 'Save changes'}
                    </Button>
                    <Button type="button" variant="secondary" onClick={cancelEditing} disabled={saving}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          <div className="space-y-2">
            <h2 className="text-lg font-semibold tracking-tight">Photos</h2>
            {media === null ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <>
                {media.some((item) => item.type === 'photo') && (
                  <AlbumLinkStatusCard
                    status="not_checked"
                    photoCount={media.filter((item) => item.type === 'photo').length}
                  />
                )}
                <PropertyPhotoGallery session={session} propertyId={id} media={media} onChange={setMedia} />
              </>
            )}
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-semibold tracking-tight">Documents</h2>
            {documents === null ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <PropertyDocumentsSection
                session={session}
                propertyId={id}
                documents={documents}
                onChange={setDocuments}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
