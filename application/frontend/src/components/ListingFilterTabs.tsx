import { cn } from '@/lib/utils';

// tb-listings-filters-001: a single generic tab row shared by ListingsPage's
// three independent filter facets (Status / Type / Expiry). Deliberately not
// a shadcn "Tabs" primitive -- there wasn't one already in components/ui, and
// this repo's convention (per CLAUDE.md-adjacent tracer bullets) is to keep
// new UI additions small and inline rather than pulling in a new dependency
// for three rows of buttons. Each row is independent; ListingsPage combines
// all three with AND semantics when deriving the visible listings.
export type FilterTabOption<T extends string> = {
  value: T;
  label: string;
};

type Props<T extends string> = {
  label: string;
  options: readonly FilterTabOption<T>[];
  value: T;
  onChange: (value: T) => void;
};

export function ListingFilterTabs<T extends string>({ label, options, value, onChange }: Props<T>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-24 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              value === option.value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
