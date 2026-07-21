import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { FileUploadDropzone } from '../components/FileUploadDropzone';
import { MappingReviewTable } from '../components/MappingReviewTable';
import { PreviewTable } from '../components/PreviewTable';
import {
  analyzeMappings,
  previewMappings,
  uploadCsv,
  type FieldMapping,
  type PreviewProperty,
} from '../lib/migrationsApi';

type Step = 'upload' | 'mapping' | 'preview';

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
  const [warnings, setWarnings] = useState<string[]>([]);

  const [previewProperties, setPreviewProperties] = useState<PreviewProperty[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [totalValidationErrors, setTotalValidationErrors] = useState(0);
  const [confirmed, setConfirmed] = useState(false);

  const accessToken = session.access_token;

  async function handleFileSelected(file: File) {
    setError(null);
    setBusy(true);
    try {
      const uploaded = await uploadCsv(accessToken, file);
      setFileId(uploaded.file_id);
      const analyzed = await analyzeMappings(accessToken, uploaded.file_id);
      setMappings(analyzed.mappings);
      setWarnings(analyzed.warnings);
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

  function handleStartOver() {
    setStep('upload');
    setFileId(null);
    setMappings([]);
    setWarnings([]);
    setPreviewProperties([]);
    setConfirmed(false);
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
          <h2>Review the suggested mappings</h2>
          <MappingReviewTable mappings={mappings} warnings={warnings} onChange={setMappings} />
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
          {confirmed ? (
            <p>
              Confirmed. Importing into Residoro is not built yet — that's the next tracer bullet
              (tb-migration-preview-001).
            </p>
          ) : (
            <>
              <button onClick={() => setConfirmed(true)}>These look correct</button>
              <button onClick={() => setStep('mapping')}>Edit mappings</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
