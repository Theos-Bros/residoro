import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { FileUploadDropzone } from '../components/FileUploadDropzone';
import { MappingReviewTable } from '../components/MappingReviewTable';
import { PreviewTable } from '../components/PreviewTable';
import { PropertyCard } from '../components/PropertyCard';
import { ConfirmImportModal } from '../components/ConfirmImportModal';
import { ImportBatchDetail } from '../components/ImportBatchDetail';
import {
  analyzeMappings,
  confirmImport,
  fetchImportBatch,
  previewMappings,
  uploadCsv,
  type BatchDetail,
  type FieldMapping,
  type PreviewProperty,
} from '../lib/migrationsApi';

type Step = 'upload' | 'mapping' | 'preview' | 'imported';

type Props = {
  session: Session;
  readOnly?: boolean;
};

export function MigrationPage({ session, readOnly = false }: Props) {
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

  async function handleFileSelected(file: File) {
    setError(null);
    setBusy(true);
    try {
      const uploaded = await uploadCsv(accessToken, file);
      setFileId(uploaded.file_id);
      const analyzed = await analyzeMappings(accessToken, uploaded.file_id);
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
      const result = await confirmImport(accessToken, fileId);
      const detail = await fetchImportBatch(accessToken, result.batch_id);
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
      <h1>Migrate properties from CSV</h1>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {busy && <p>Working…</p>}

      {step === 'upload' && readOnly && (
        <p>
          Migration is disabled while your workspace is in a read-only or blocked state. Contact
          your Residoro representative to renew.
        </p>
      )}
      {step === 'upload' && !readOnly && <FileUploadDropzone onFileSelected={handleFileSelected} disabled={busy} />}

      {step === 'mapping' && (
        <div>
          <h2>Review the mappings</h2>
          <MappingReviewTable mappings={mappings} onChange={setMappings} />
          <button onClick={handleGeneratePreview} disabled={busy}>
            These look correct — show preview
          </button>
          <button onClick={handleStartOver} disabled={busy}>
            Start over
          </button>
        </div>
      )}

      {step === 'preview' && (
        <div>
          <h2>Preview</h2>
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
        <div>
          <ImportBatchDetail batch={batch} />
          <button onClick={handleStartOver}>Start another migration</button>
        </div>
      )}
    </div>
  );
}
