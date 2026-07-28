import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Minus, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  title: string;
  documentTitle?: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
};

// tb-listings-lifecycle-001 (UX follow-up): Messenger/Gmail-compose-style
// floating panel, bottom-right, one at a time -- lets an agent create a
// listing or check a property's history without losing their place on
// PropertiesListPage/ListingsPage. Plain fixed-position div, no portal:
// this codebase's other overlay (ConfirmImportModal) is also a plain inline
// element, not a portal-rendered one, so this follows the same precedent.
//
// tb-design-system-panel-collapse-001: adds a third presentation state
// (collapsed, alongside open/closed) -- minimizing shows a small circular
// placeholder-"R" badge instead of unmounting the panel, so in-progress
// content (e.g. LeadDetailPanel's unsaved form state) survives. `children`
// stays mounted the whole time (the dialog div is only CSS-hidden, not
// removed from the tree) -- only the badge button is conditionally rendered.
// Scoped to a single panel, same-page-only, per explicit user decision: this
// does NOT reverse the "one at a time" convention above, and does NOT persist
// across page navigation (the panel still fully unmounts on route change,
// collapsed or not).
export function FloatingPanel({ title, documentTitle, onClose, children, className }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (collapsed) return;
    function handlePointerDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, collapsed]);

  // UX follow-up: "the title bar of the window" (the browser tab) should
  // show the property being listed/viewed while a panel is open, so it's
  // identifiable among other tabs -- restores whatever the tab said before
  // this panel opened once it closes.
  useEffect(() => {
    if (!documentTitle) return;
    const previousTitle = document.title;
    document.title = documentTitle;
    return () => {
      document.title = previousTitle;
    };
  }, [documentTitle]);

  return (
    <>
      {collapsed && (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label={`Expand ${title}`}
          className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full border bg-card text-lg font-semibold text-card-foreground shadow-xl hover:bg-accent"
        >
          R
        </button>
      )}
      <div
        ref={panelRef}
        role="dialog"
        aria-label={title}
        className={cn(
          'fixed bottom-6 right-6 z-50 flex max-h-[32rem] w-[calc(100vw-3rem)] max-w-96 flex-col overflow-hidden rounded-lg border bg-card text-card-foreground shadow-xl',
          collapsed && 'hidden',
          className,
        )}
      >
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          onClick={() => setCollapsed(true)}
        >
          <h2 className="text-sm font-semibold">{title}</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setCollapsed(true);
              }}
              aria-label="Minimize"
              className="rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              aria-label="Close"
              className="rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </>
  );
}
