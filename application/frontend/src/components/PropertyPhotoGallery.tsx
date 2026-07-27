import { useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  addPropertyMediaLink,
  deletePropertyMedia,
  updatePropertyMedia,
  type MediaType,
  type PropertyMedia,
} from '@/lib/propertyMediaApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Props = {
  session: Session;
  propertyId: string;
  media: PropertyMedia[];
  onChange: (media: PropertyMedia[]) => void;
};

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// tb-properties-media-external-links-001: native HTML5 drag-and-drop for
// reordering (no new dependency), unchanged from tb-properties-photos-001.
// Residoro doesn't host any file here -- every item is a pasted external
// link (Google Photos or elsewhere), rendered as a link-out, never an <img>.
export function PropertyPhotoGallery({ session, propertyId, media, onChange }: Props) {
  const [linkInput, setLinkInput] = useState('');
  const [linkType, setLinkType] = useState<MediaType>('photo');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  async function handleAddLink(e: FormEvent) {
    e.preventDefault();
    if (!linkInput.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const added = await addPropertyMediaLink(session.access_token, propertyId, linkInput.trim(), linkType);
      onChange([...media, added]);
      setLinkInput('');
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
              className="group relative flex aspect-square flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border bg-muted p-2 text-center"
            >
              <a
                href={item.external_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                <span aria-hidden className="text-2xl">
                  {item.type === 'video' ? '🎬' : '🖼️'}
                </span>
                <span className="line-clamp-2 break-all">{hostnameOf(item.external_url)}</span>
              </a>
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

      <form onSubmit={handleAddLink} className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="url"
          placeholder="Paste a photo or video link (e.g. a Google Photos album)"
          value={linkInput}
          onChange={(e) => setLinkInput(e.target.value)}
          disabled={busy}
          required
          className="flex-1"
        />
        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant={linkType === 'photo' ? 'default' : 'outline'}
            onClick={() => setLinkType('photo')}
          >
            Photo
          </Button>
          <Button
            type="button"
            size="sm"
            variant={linkType === 'video' ? 'default' : 'outline'}
            onClick={() => setLinkType('video')}
          >
            Video
          </Button>
          <Button type="submit" size="sm" disabled={busy || !linkInput.trim()}>
            Add link
          </Button>
        </div>
      </form>
    </div>
  );
}
