import type { PreviewProperty } from '../lib/migrationsApi';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Props = {
  contact: PreviewProperty;
};

function field(value: unknown): string {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

export function ContactCard({ contact }: Props) {
  const hasErrors = contact.validation_errors.length > 0;

  return (
    <Card className={cn(hasErrors && 'border-destructive')}>
      <CardHeader className="space-y-1 p-4 pb-0">
        <p className="text-xs text-muted-foreground">Row {contact.row_number}</p>
        <h3 className="text-lg font-semibold leading-tight">{field(contact.name)}</h3>
        <p className="text-sm font-medium text-muted-foreground">{field(contact.type)}</p>
      </CardHeader>
      <CardContent className="space-y-2 p-4 pt-2">
        <dl className="grid grid-cols-1 gap-y-1 text-sm text-muted-foreground">
          <div>
            <dt className="inline font-medium">Email:</dt> <dd className="inline">{field(contact.email)}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Phone:</dt> <dd className="inline">{field(contact.phone)}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Company:</dt> <dd className="inline">{field(contact.company)}</dd>
          </div>
        </dl>
        {hasErrors && (
          <ul className="space-y-1 text-sm text-destructive">
            {contact.validation_errors.map((message, index) => (
              <li key={index}>⚠️ {message}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
