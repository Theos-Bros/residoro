import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  deletePropertyDocument,
  uploadPropertyDocument,
  type DocumentType,
  type PropertyDocument,
} from '@/lib/propertyDocumentsApi';
import { FileUploadDropzone } from '@/components/FileUploadDropzone';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';

type Props = {
  session: Session;
  propertyId: string;
  documents: PropertyDocument[];
  onChange: (documents: PropertyDocument[]) => void;
};

const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  title_deed: 'Title Deed',
  tax_declaration: 'Tax Declaration',
  other: 'Other',
};

const selectClass = 'flex h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm';

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString();
}

// tb-properties-documents-001: a flat list, not a gallery -- documents have
// no cover/sort_order/reorder concept the way property_media's photos do
// (tb-properties-photos-001), so this deliberately has no drag handles.
export function PropertyDocumentsSection({ session, propertyId, documents, onChange }: Props) {
  const [documentType, setDocumentType] = useState<DocumentType>('title_deed');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(file: File) {
    setError(null);
    setBusy(true);
    try {
      const uploaded = await uploadPropertyDocument(session.access_token, propertyId, file, documentType);
      onChange([...documents, uploaded]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(documentId: string) {
    setError(null);
    try {
      await deletePropertyDocument(session.access_token, propertyId, documentId);
      onChange(documents.filter((d) => d.id !== documentId));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {documents.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="flex min-w-0 items-center gap-3">
                <Badge variant="outline">{DOCUMENT_TYPE_LABELS[doc.document_type]}</Badge>
                <span className="truncate text-sm">{doc.file_name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatDate(doc.created_at)}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {doc.url && (
                  <Button asChild size="sm" variant="secondary" className="h-7 px-2 text-xs">
                    <a href={doc.url} target="_blank" rel="noreferrer">
                      Download
                    </a>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 px-2 text-xs"
                  onClick={() => handleDelete(doc.id)}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="document_type">Document type</Label>
        <select
          id="document_type"
          value={documentType}
          onChange={(e) => setDocumentType(e.target.value as DocumentType)}
          className={selectClass}
        >
          <option value="title_deed">Title Deed</option>
          <option value="tax_declaration">Tax Declaration</option>
          <option value="other">Other</option>
        </select>
      </div>

      <FileUploadDropzone
        onFileSelected={handleUpload}
        disabled={busy}
        accept="application/pdf,image/jpeg,image/png,image/webp"
        maxSizeMb={10}
        helperText="Drag and drop a document here, or click to choose a file."
      />
    </div>
  );
}
