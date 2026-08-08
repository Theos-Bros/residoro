import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

// tb-search-core-entities-001 follow-up: a global search result that lands
// on a list page only (no per-record detail route) passes { highlightId }
// via navigate() state. This scrolls that row into view once the list has
// loaded and applies a persistent highlight until the row itself is
// interacted with -- pair with a `data-row-id={row.id}` attribute on each
// row and `highlightedId === row.id` for the highlight class.
//
// Keyed off `location.key` (React Router's unique-per-navigation id), not
// just the initial `highlightId` value -- clicking a second search result
// while already on this page (e.g. /leads -> /leads) doesn't remount the
// component, so a plain `useState(highlightId)` initializer would silently
// keep stale state. Re-syncing on every `location.key` change, and
// re-running the scroll-into-view on every fresh highlightId, fixes both.
export function useHighlightFromSearch(dataLoaded: boolean) {
  const location = useLocation();
  const highlightId = (location.state as { highlightId?: string } | null)?.highlightId ?? null;
  const [highlightedId, setHighlightedId] = useState<string | null>(highlightId);
  const scrolledForKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setHighlightedId(highlightId);
  }, [location.key, highlightId]);

  useEffect(() => {
    if (!highlightId || !dataLoaded || scrolledForKeyRef.current === location.key) return;
    const el = document.querySelector(`[data-row-id="${highlightId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      scrolledForKeyRef.current = location.key;
    }
  }, [highlightId, dataLoaded, location.key]);

  return { highlightedId, clearHighlight: () => setHighlightedId(null) };
}
