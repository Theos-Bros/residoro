import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { fetchProperty, fetchPropertyMedia, type PropertyDetail, type PropertyMedia } from '@/lib/propertyMediaApi';
import { fetchPropertyDocuments, type PropertyDocument } from '@/lib/propertyDocumentsApi';
import { updatePropertyVerification, VERIFICATION_STATUSES, type VerificationStatus } from '@/lib/listingsApi';
import { useWorkspaceStatus } from '@/hooks/useWorkspaceStatus';
import { PropertyPhotoGallery } from '@/components/PropertyPhotoGallery';
import { PropertyDocumentsSection } from '@/components/PropertyDocumentsSection';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type Props = {
  session: Session;
};

const verificationSelectClass =
  'h-7 rounded-md border border-input bg-background px-2 text-xs shadow-sm';

function formatPrice(value: number | null, currency: string): string {
  return value === null ? '—' : `${currency} ${value.toLocaleString()}`;
}

// tb-properties-photos-001: no single-property view existed before this --
// only PropertiesListPage (a list) and PropertyCard (unrelated, migration-
// preview only). Deliberately minimal: core fields read-only + the photo
// gallery, not a full edit experience (see the tracer bullet's
// semantic_scope).
export function PropertyDetailPage({ session }: Props) {
  const { id } = useParams<{ id: string }>();
  const [property, setProperty] = useState<PropertyDetail | null>(null);
  const [media, setMedia] = useState<PropertyMedia[] | null>(null);
  const [documents, setDocuments] = useState<PropertyDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { status: workspaceStatus } = useWorkspaceStatus(session);
  const isAdmin = workspaceStatus?.role === 'admin';

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
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{property.title}</h1>
              <Badge variant="outline">{property.status}</Badge>
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
                <Badge variant="secondary">{property.verification_status}</Badge>
              )}
            </div>
            <p className="text-lg font-medium">{formatPrice(property.price, property.price_currency)}</p>
            <p className="text-sm text-muted-foreground">
              {[property.address, property.city, property.province].filter(Boolean).join(', ') || '—'}
            </p>
            {property.project_name && (
              <p className="text-sm text-muted-foreground">
                Part of{' '}
                <Link to={`/projects/${property.project_id}`} className="hover:underline">
                  {property.project_name}
                </Link>
              </p>
            )}
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-semibold tracking-tight">Photos</h2>
            {media === null ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <PropertyPhotoGallery session={session} propertyId={id} media={media} onChange={setMedia} />
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
