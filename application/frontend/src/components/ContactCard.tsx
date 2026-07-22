import type { PreviewProperty } from '../lib/migrationsApi';

type Props = {
  contact: PreviewProperty;
};

function field(value: unknown): string {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

export function ContactCard({ contact }: Props) {
  const hasErrors = contact.validation_errors.length > 0;

  return (
    <div className={`rounded-lg border p-4 shadow-sm ${hasErrors ? 'border-red-400' : 'border-gray-200'}`}>
      <p className="text-xs text-gray-500">Row {contact.row_number}</p>
      <h3 className="text-lg font-semibold">{field(contact.name)}</h3>
      <p className="text-sm font-medium text-gray-700">{field(contact.type)}</p>
      <dl className="mt-2 grid grid-cols-1 gap-y-1 text-sm text-gray-600">
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
        <ul className="mt-2 text-sm text-red-600">
          {contact.validation_errors.map((message, index) => (
            <li key={index}>⚠️ {message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
