import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Props = {
  title: string;
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
export function FloatingPanel({ title, onClose, children, className }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={title}
      className={cn(
        'fixed bottom-6 right-6 z-50 flex max-h-[32rem] w-96 flex-col overflow-hidden rounded-lg border bg-background shadow-xl',
        className,
      )}
    >
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-sm text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
      </div>
      <div className="overflow-y-auto p-4">{children}</div>
    </div>
  );
}
