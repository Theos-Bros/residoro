// Mirrors supabase/functions/contract-expiry-check/index.ts's Resend call
// (same API, same graceful-skip-if-unset behavior) -- that one runs in Deno
// with its own secret store; this is the Node/Fastify-side equivalent for
// tb-migration-preview-001's import summary email, which fires from a normal
// backend request rather than a scheduled Edge Function.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM_EMAIL ?? 'Residoro <onboarding@resend.dev>';

export async function sendImportSummaryEmail(params: {
  to: string;
  filename: string;
  totalRows: number;
  successfulImports: number;
  failedRows: number;
  batchDetailUrl: string;
}) {
  if (!RESEND_API_KEY) {
    console.error(`RESEND_API_KEY not set -- skipping import summary email for "${params.filename}"`);
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [params.to],
      subject: `Import complete: ${params.successfulImports} properties added to Residoro`,
      html: `<p>Successfully imported ${params.successfulImports} of ${params.totalRows} properties from ${params.filename}.</p>` +
        (params.failedRows > 0
          ? `<p>${params.failedRows} row${params.failedRows === 1 ? '' : 's'} had errors — <a href="${params.batchDetailUrl}">view details</a>.</p>`
          : '') +
        `<p>You can review this import for the next 24 hours.</p>`,
    }),
  });

  if (!response.ok) {
    console.error(`Resend send failed for import summary ("${params.filename}"):`, response.status, await response.text());
  }
}
