import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { FileUploadDropzone } from '@/components/FileUploadDropzone';
import { MappingReviewTable } from '@/components/MappingReviewTable';
import { PreviewTable } from '@/components/PreviewTable';
import { PropertyCard } from '@/components/PropertyCard';
import { ConfirmImportModal } from '@/components/ConfirmImportModal';
import { ImportBatchDetail } from '@/components/ImportBatchDetail';
import { Button } from '@/components/ui/button';
import {
  analyzeMappings,
  confirmImport,
  fetchImportBatch,
  previewMappings,
  uploadCsv,
  type BatchDetail,
  type FieldMapping,
  type PreviewProperty,
} from '@/lib/migrationsApi';

type Step = 'upload' | 'mapping' | 'preview' | 'imported';

type Props = {
  session: Session;
};

// Relocated from pages/MigrationPage.tsx (tb-client-lifecycle-migration-
// execution-001): migration is operator-run on a selected client's behalf,
// per cap-client-lifecycle-001 Decision #2, so it lives in the admin
// dashboard now, not the brokerage's own login flow. tenantId comes from the
// route -- the client the operator picked in ClientList -- and threads
// through to every migrationsApi call so writes land in that client's
// tenant, not the operator's (who has none). No readOnly gate here: that
// existed to stop an expired *client* self-servicing further action: it
// doesn't apply to an operator acting on the client's behalf, see
// requireMigrationAccess's comment in the backend.
export function ClientMigration({ session }: Props) {
  const { tenantId } = useParams<{ tenantId: string }>();
  const [step, setStep] = useState<Step>('upload');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fileId, setFileId] = useState<string | null>(null);
  const [mappings, setMappings] = useState<FieldMapping[]>([]);

  const [previewProperties, setPreviewProperties] = useState<PreviewProperty[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [totalValidationErrors, setTotalValidationErrors] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [batch, setBatch] = useState<BatchDetail | null>(null);

  const accessToken = session.access_token;

  if (!tenantId) {
    return <p className="text-sm text-destructive">No client selected.</p>;
  }

  async function handleFileSelected(file: File) {
    setError(null);
    setBusy(true);
    try {
      const uploaded = await uploadCsv(accessToken, file, tenantId);
      setFileId(uploaded.file_id);
      const analyzed = await analyzeMappings(accessToken, uploaded.file_id, tenantId);
      setMappings(analyzed.mappings);
      setStep('mapping');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleGeneratePreview() {
    if (!fileId) return;
    setError(null);
    setBusy(true);
    try {
      const result = await previewMappings(
        accessToken,
        fileId,
        mappings.map(({ csv_column, residoro_field }) => ({ csv_column, residoro_field })),
        tenantId,
      );
      setPreviewProperties(result.sample_properties);
      setTotalRows(result.total_rows);
      setTotalValidationErrors(result.total_validation_errors);
      setStep('preview');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmImport() {
    if (!fileId) return;
    setError(null);
    setConfirming(true);
    try {
      const result = await confirmImport(accessToken, fileId, tenantId);
      const detail = await fetchImportBatch(accessToken, result.batch_id, tenantId);
      setBatch(detail);
      setStep('imported');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConfirming(false);
    }
  }

  function handleStartOver() {
    setStep('upload');
    setFileId(null);
    setMappings([]);
    setPreviewProperties([]);
    setBatch(null);
    setError(null);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Migrate properties from CSV</h1>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin">Back to clients</Link>
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      {busy && <p className="mt-2 text-sm text-muted-foreground">Working…</p>}

      {step === 'upload' && (
        <div className="mt-4">
          <FileUploadDropzone onFileSelected={handleFileSelected} disabled={busy} />
        </div>
      )}

      {step === 'mapping' && (
        <div className="mt-4">
          <h2 className="text-lg font-semibold">Review the mappings</h2>
          <div className="mt-2">
            <MappingReviewTable mappings={mappings} onChange={setMappings} />
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={handleGeneratePreview} disabled={busy}>
              These look correct — show preview
            </Button>
            <Button variant="outline" onClick={handleStartOver} disabled={busy}>
              Start over
            </Button>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="mt-4">
          <h2 className="text-lg font-semibold">Preview</h2>
          <PreviewTable
            properties={previewProperties}
            totalRows={totalRows}
            totalValidationErrors={totalValidationErrors}
          />
          <h3 className="mt-6 mb-2 text-lg font-semibold">Card view</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {previewProperties.map((property) => (
              <PropertyCard key={property.row_number} property={property} />
            ))}
          </div>
          <ConfirmImportModal
            totalRows={totalRows}
            busy={confirming}
            onConfirm={handleConfirmImport}
            onCancel={() => setStep('mapping')}
          />
        </div>
      )}

      {step === 'imported' && batch && (
        <div className="mt-4">
          <ImportBatchDetail batch={batch} />
          <Button className="mt-4" onClick={handleStartOver}>
            Start another migration
          </Button>
        </div>
      )}
    </div>
  );
}
