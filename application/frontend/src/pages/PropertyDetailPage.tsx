import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { fetchProperty, fetchPropertyMedia, type PropertyDetail, type PropertyMedia } from '@/lib/propertyMediaApi';
import { fetchPropertyDocuments, type PropertyDocument } from '@/lib/propertyDocumentsApi';
import { PropertyPhotoGallery } from '@/components/PropertyPhotoGallery';
import { PropertyDocumentsSection } from '@/components/PropertyDocumentsSection';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type Props = {
  session: Session;
};

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
            </div>
            <p className="text-lg font-medium">{formatPrice(property.price, property.price_currency)}</p>
            <p className="text-sm text-muted-foreground">
              {[property.address, property.city, property.province].filter(Boolean).join(', ') || '—'}
            </p>
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
