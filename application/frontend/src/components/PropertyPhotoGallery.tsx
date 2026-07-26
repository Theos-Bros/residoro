import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  deletePropertyMedia,
  updatePropertyMedia,
  uploadPropertyPhoto,
  type PropertyMedia,
} from '@/lib/propertyMediaApi';
import { FileUploadDropzone } from '@/components/FileUploadDropzone';
import { Button } from '@/components/ui/button';

type Props = {
  session: Session;
  propertyId: string;
  media: PropertyMedia[];
  onChange: (media: PropertyMedia[]) => void;
};

// tb-properties-photos-001: native HTML5 drag-and-drop for reordering (no
// new dependency) -- consistent with FileUploadDropzone's own pre-existing
// use of native drag events rather than a library.
export function PropertyPhotoGallery({ session, propertyId, media, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  async function handleUpload(file: File) {
    setError(null);
    setBusy(true);
    try {
      const uploaded = await uploadPropertyPhoto(session.access_token, propertyId, file);
      onChange([...media, uploaded]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSetCover(mediaId: string) {
    setError(null);
    try {
      await updatePropertyMedia(session.access_token, propertyId, mediaId, { is_cover: true });
      onChange(media.map((m) => ({ ...m, is_cover: m.id === mediaId })));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDelete(mediaId: string) {
    setError(null);
    const deleted = media.find((m) => m.id === mediaId);
    try {
      await deletePropertyMedia(session.access_token, propertyId, mediaId);
      const remaining = media.filter((m) => m.id !== mediaId);
      // Mirrors the backend's own auto-promote-next-cover behavior so the
      // gallery doesn't show zero covers until the next full refetch.
      if (deleted?.is_cover && remaining.length > 0) {
        const next = [...remaining].sort((a, b) => a.sort_order - b.sort_order)[0];
        onChange(remaining.map((m) => ({ ...m, is_cover: m.id === next.id })));
      } else {
        onChange(remaining);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDrop(targetId: string) {
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null);
      return;
    }
    const ordered = [...media].sort((a, b) => a.sort_order - b.sort_order);
    const fromIndex = ordered.findIndex((m) => m.id === draggedId);
    const toIndex = ordered.findIndex((m) => m.id === targetId);
    if (fromIndex === -1 || toIndex === -1) {
      setDraggedId(null);
      return;
    }

    const reordered = [...ordered];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    const withNewOrder = reordered.map((m, index) => ({ ...m, sort_order: index }));
    onChange(withNewOrder);
    setDraggedId(null);

    try {
      await Promise.all(
        withNewOrder.map((m) => updatePropertyMedia(session.access_token, propertyId, m.id, { sort_order: m.sort_order })),
      );
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const ordered = [...media].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {ordered.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {ordered.map((item) => (
            <div
              key={item.id}
              draggable
              onDragStart={() => setDraggedId(item.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(item.id)}
              className="group relative aspect-square overflow-hidden rounded-lg border bg-muted"
            >
              {item.url ? (
                <img src={item.url} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                  Loading…
                </div>
              )}
              {item.is_cover && (
                <span className="absolute left-1 top-1 rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
                  Cover
                </span>
              )}
              <div className="absolute inset-x-0 bottom-0 flex justify-between gap-1 bg-black/60 p-1 opacity-0 transition-opacity group-hover:opacity-100">
                {!item.is_cover && (
                  <Button size="sm" variant="secondary" className="h-6 px-2 text-xs" onClick={() => handleSetCover(item.id)}>
                    Set as cover
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-6 px-2 text-xs"
                  onClick={() => handleDelete(item.id)}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <FileUploadDropzone
        onFileSelected={handleUpload}
        disabled={busy}
        accept="image/jpeg,image/png,image/webp"
        maxSizeMb={10}
        multiple
        helperText="Drag and drop photos here, or click to choose files."
      />
    </div>
  );
}
