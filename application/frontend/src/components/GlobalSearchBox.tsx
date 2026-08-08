import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { globalSearch, type GlobalSearchEntityType, type GlobalSearchResult } from '@/lib/globalSearchApi';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type Props = {
  session: Session;
};

const ENTITY_LABELS: Record<GlobalSearchEntityType, string> = {
  property: 'Properties',
  listing: 'Listings',
  contact: 'Contacts',
  task: 'Tasks',
  project: 'Projects',
};

// tb-search-core-entities-001: cap-search-001's TB1. A header-level box, not
// a nav link -- /search already means cap-buyer-leads-001's matching search.
// Results navigate to the entity's list page only (no deep-link into a
// specific record's modal/panel for Properties/Listings/Contacts/Tasks,
// which all open their detail view via local component state); Projects
// alone has a real per-record route, /projects/:id.
export function GlobalSearchBox({ session }: Props) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GlobalSearchResult[] | null>(null);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(null);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      globalSearch(session.access_token, trimmed)
        .then((response) => {
          setResults(response.results);
          setOpen(true);
        })
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, session.access_token]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function goToResult(result: GlobalSearchResult) {
    setOpen(false);
    setQuery('');
    setResults(null);
    if (result.entity_type === 'project') {
      navigate(`/projects/${result.entity_id}`);
      return;
    }
    const routeByType: Record<Exclude<GlobalSearchEntityType, 'project'>, string> = {
      property: '/properties',
      listing: '/listings',
      contact: '/contacts',
      task: '/tasks',
    };
    navigate(routeByType[result.entity_type]);
  }

  const grouped = (results ?? []).reduce<Partial<Record<GlobalSearchEntityType, GlobalSearchResult[]>>>((acc, r) => {
    (acc[r.entity_type] ??= []).push(r);
    return acc;
  }, {});
  const groupOrder: GlobalSearchEntityType[] = ['property', 'listing', 'contact', 'task', 'project'];

  return (
    <div ref={containerRef} className="relative w-full max-w-sm">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tertiary-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results && setOpen(true)}
          placeholder="Search properties, listings, contacts…"
          className="pl-9"
          aria-label="Global search"
        />
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-96 overflow-y-auto rounded-md border bg-card shadow-lg">
          {searching && <p className="p-3 text-sm text-muted-foreground">Searching…</p>}
          {!searching && results && results.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">No results.</p>
          )}
          {!searching &&
            groupOrder
              .filter((type) => grouped[type]?.length)
              .map((type) => (
                <div key={type} className="border-b last:border-b-0">
                  <p className="px-3 pt-2 font-mono text-[10px] font-medium uppercase tracking-widest text-tertiary-foreground">
                    {ENTITY_LABELS[type]}
                  </p>
                  {grouped[type]!.map((result) => (
                    <button
                      key={`${result.entity_type}-${result.entity_id}`}
                      type="button"
                      onClick={() => goToResult(result)}
                      className={cn(
                        'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-secondary',
                      )}
                    >
                      <span className="font-medium text-foreground">{result.title}</span>
                      {result.subtitle && <span className="text-xs text-muted-foreground">{result.subtitle}</span>}
                    </button>
                  ))}
                </div>
              ))}
        </div>
      )}
    </div>
  );
}
