import type { ProjectUnitsSummary, StatusCounts, UnitLabelsByStatus } from '@/lib/projectsApi';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

type Props = {
  summary: ProjectUnitsSummary;
};

const STATUS_LABELS: Record<string, string> = {
  available: 'available',
  reserved: 'reserved',
  sold: 'sold',
  off_market: 'off market',
  leased: 'leased',
};

function StatusBadges({ byStatus }: { byStatus: StatusCounts }) {
  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(byStatus).map(([status, count]) => (
        <Badge key={status} variant="outline">
          {count} {STATUS_LABELS[status] ?? status}
        </Badge>
      ))}
    </div>
  );
}

// tb-properties-project-rollup-001 follow-up: lists the actual unit/lot
// labels behind each status count -- e.g. "Available: 1F, 2B, 2C, 3F" --
// so an operator can see which specific units are available, not just how
// many. Statuses with zero units are omitted rather than shown empty.
function UnitLabelsByStatusList({ unitsByStatus }: { unitsByStatus: UnitLabelsByStatus }) {
  const nonEmpty = Object.entries(unitsByStatus).filter(([, labels]) => labels.length > 0);
  if (nonEmpty.length === 0) return null;

  return (
    <div className="space-y-1">
      {nonEmpty.map(([status, labels]) => (
        <p key={status} className="text-xs text-muted-foreground">
          <span className="font-medium capitalize">{STATUS_LABELS[status] ?? status}:</span>{' '}
          {labels.join(', ')}
        </p>
      ))}
    </div>
  );
}

// tb-properties-project-rollup-001: pure display -- one fetch owned by
// ProjectDetailPage, no mutations here (unlike UnitTypesSection).
export function UnitsSummarySection({ summary }: Props) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-2 pt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">{summary.total} unit{summary.total === 1 ? '' : 's'} generated</span>
            {summary.declared_total_units !== null && (
              <span className="text-xs text-muted-foreground">
                Declared total: {summary.declared_total_units}
              </span>
            )}
          </div>
          <StatusBadges byStatus={summary.by_status} />
        </CardContent>
      </Card>

      {summary.by_unit_type.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {summary.by_unit_type.map((unitType) => (
            <li key={unitType.unit_type_id ?? 'other'} className="space-y-2 px-3 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{unitType.unit_type_name}</span>
                <span className="text-xs text-muted-foreground">
                  {unitType.total} unit{unitType.total === 1 ? '' : 's'}
                </span>
              </div>
              <StatusBadges byStatus={unitType.by_status} />
              <UnitLabelsByStatusList unitsByStatus={unitType.units_by_status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
