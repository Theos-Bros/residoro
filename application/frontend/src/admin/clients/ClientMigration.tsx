import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { FileUploadDropzone } from '@/components/FileUploadDropzone';
import { MappingReviewTable, PROPERTY_FIELD_OPTIONS, CONTACT_FIELD_OPTIONS } from '@/components/MappingReviewTable';
import { PreviewTable } from '@/components/PreviewTable';
import { PropertyCard } from '@/components/PropertyCard';
import { ContactCard } from '@/components/ContactCard';
import { ConfirmImportModal } from '@/components/ConfirmImportModal';
import { ImportBatchDetail } from '@/components/ImportBatchDetail';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  analyzeMappings,
  confirmImport,
  fetchImportBatch,
  previewMappings,
  uploadCsv,
  type BatchDetail,
  type EntityType,
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
//
// tb-migration-contacts-001: a migration now targets one of two entities
// (properties or contacts), picked before upload -- everything downstream
// (mapping field options, card rendering, dropzone label) branches on that
// choice, threaded through as `entityType`.
export function ClientMigration({ session }: Props) {
  const { tenantId } = useParams<{ tenantId: string }>();
  const [entityType, setEntityType] = useState<EntityType | null>(null);
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
    if (!entityType) return;
    setError(null);
    setBusy(true);
    try {
      const uploaded = await uploadCsv(accessToken, file, entityType, tenantId);
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
    setEntityType(null);
    setStep('upload');
    setFileId(null);
    setMappings([]);
    setPreviewProperties([]);
    setBatch(null);
    setError(null);
  }

  const heading =
    step === 'upload' && !entityType
      ? 'Migrate client data from CSV'
      : entityType === 'contact'
        ? 'Migrate contacts from CSV'
        : 'Migrate properties from CSV';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin">Back to clients</Link>
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {busy && <p className="text-sm text-muted-foreground">Working…</p>}

      {step === 'upload' && !entityType && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">What are you migrating for this client?</p>
            <div className="mt-3 flex gap-2">
              <Button onClick={() => setEntityType('property')}>Properties</Button>
              <Button onClick={() => setEntityType('contact')}>Contacts</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'upload' && entityType && (
        <FileUploadDropzone
          onFileSelected={handleFileSelected}
          disabled={busy}
          label={entityType === 'contact' ? 'contacts' : 'property'}
        />
      )}

      {step === 'mapping' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">Review the mappings</h2>
          <MappingReviewTable
            mappings={mappings}
            fieldOptions={entityType === 'contact' ? CONTACT_FIELD_OPTIONS : PROPERTY_FIELD_OPTIONS}
            onChange={setMappings}
          />
          <div className="flex gap-2">
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
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Preview</h2>
            <PreviewTable
              properties={previewProperties}
              totalRows={totalRows}
              totalValidationErrors={totalValidationErrors}
            />
          </div>
          <div>
            <h3 className="mb-2 text-lg font-semibold tracking-tight">Card view</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {previewProperties.map((property) =>
                entityType === 'contact' ? (
                  <ContactCard key={property.row_number} contact={property} />
                ) : (
                  <PropertyCard key={property.row_number} property={property} />
                ),
              )}
            </div>
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
        <div className="space-y-4">
          <ImportBatchDetail batch={batch} />
          <Button onClick={handleStartOver}>Start another migration</Button>
        </div>
      )}
    </div>
  );
}
