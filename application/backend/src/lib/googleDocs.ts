import { google } from 'googleapis';

// tb-buyer-leads-match-itinerary-001: residoro's first external third-party
// API integration. Real googleapis-based Docs/Drive client, per the tracer
// bullet's explicit Decision #3/#4 -- a live Google Doc created under ONE
// shared Residoro-owned service account (not per-agent OAuth), then shared
// out to the requesting agent.
//
// Credential storage decision (the doc's own open question, resolved here):
// a single backend-only env var, GOOGLE_SERVICE_ACCOUNT_CREDENTIALS, holding
// the full GCP service-account JSON key as a one-line JSON string. This
// codebase's existing `vault.decrypted_secrets` pattern (see
// 20260722120000_contract_expiry.sql, 20260727110000_listing_authority_expiry_notification.sql)
// is Postgres-side only -- used exclusively by pg_net/pg_cron jobs calling
// Supabase Edge Functions from *inside* the database, never by the Node
// backend, which has read every other credential (SUPABASE_SERVICE_ROLE_KEY,
// RESEND_API_KEY, etc.) directly from process.env via dotenv since day one
// (see supabaseAdmin.ts, email.ts). This integration lives entirely in the
// Node backend, so following THAT precedent -- not vault -- is the actual
// "prefer consistency with what fits" call: reaching into Postgres via an
// extra service-role round trip just to fetch a credential the backend could
// read from its own process env would be inconsistent with every other
// secret this backend already owns.
//
// CREDENTIAL GAP (see tracer bullet doc + final report): this agent has no
// real GCP project/service account and cannot provision one. Set
// GOOGLE_SERVICE_ACCOUNT_CREDENTIALS in application/backend/.env to the full
// JSON key downloaded from a GCP service account (IAM & Admin > Service
// Accounts > Keys > Add key > JSON) that has the Google Docs API and Google
// Drive API enabled on its project, to finish verifying this end-to-end.

const SCOPES = ['https://www.googleapis.com/auth/documents', 'https://www.googleapis.com/auth/drive.file'];

export class GoogleDocsNotConfiguredError extends Error {
  constructor() {
    super(
      'GOOGLE_SERVICE_ACCOUNT_CREDENTIALS is not set -- itinerary generation needs a real GCP service-account JSON key (see googleDocs.ts header comment).',
    );
    this.name = 'GoogleDocsNotConfiguredError';
  }
}

export function isGoogleDocsConfigured(): boolean {
  return !!process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS;
}

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS;
  if (!raw) throw new GoogleDocsNotConfiguredError();

  let credentials: { client_email: string; private_key: string };
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_CREDENTIALS is set but is not valid JSON -- expected the full GCP service-account key file contents as a one-line JSON string.',
    );
  }

  return new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: SCOPES,
  });
}

export type ItineraryItem = {
  // Display fields only -- this lib never re-derives or re-scores anything,
  // it just formats what the caller (matchLogs.ts route) already resolved
  // and validated as tenant-eligible.
  label: string; // e.g. "Unit 4B, Skyline Residences"
  detail: string; // e.g. "PHP 3,200,000 -- condo_unit -- Makati, Metro Manila"
  sourceNote: string; // e.g. "Your inventory" / "Shared by @handle" / "Project inventory -- not yet listed"
};

export type CreateItineraryInput = {
  title: string; // doc title, e.g. "Showing Itinerary -- Juan Dela Cruz"
  buyerLabel: string;
  items: ItineraryItem[];
};

export type CreateItineraryResult = {
  documentId: string;
  url: string;
};

// tb-buyer-leads-match-itinerary-001: creates the doc, writes formatted
// itinerary content via one batchUpdate (plain paragraph text with a bolded
// title/section headers -- no attempt at rich layout beyond that, this is a
// showing-day reference doc, not a branded template). Real Docs API index
// bookkeeping: Docs documents always start with a single empty paragraph at
// index 1, so every insertText/style request below is computed against the
// string being built, applied via one batchUpdate call, in one pass -- no
// intermediate re-fetch of the document is needed for a single top-to-bottom
// insert.
export async function createItineraryDoc(input: CreateItineraryInput): Promise<CreateItineraryResult> {
  const auth = getAuth();
  const docs = google.docs({ version: 'v1', auth });

  let documentId: string;
  try {
    const created = await docs.documents.create({ requestBody: { title: input.title } });
    if (!created.data.documentId) throw new Error('Google Docs API did not return a documentId');
    documentId = created.data.documentId;
  } catch (err) {
    throw new Error(`Could not create the Google Doc: ${(err as Error).message}`);
  }

  // Build the full body text and track byte ranges for bold styling as we go.
  const boldRanges: Array<{ start: number; end: number }> = [];
  let body = '';

  function appendLine(text: string, bold: boolean) {
    const start = body.length + 1; // +1: index 1 is the doc's first character position
    body += `${text}\n`;
    if (bold) boldRanges.push({ start, end: start + text.length });
  }

  appendLine(input.title, true);
  appendLine(`Buyer: ${input.buyerLabel}`, false);
  appendLine('', false);

  if (input.items.length === 0) {
    appendLine('(No matched items were selected for this itinerary.)', false);
  } else {
    input.items.forEach((item, i) => {
      appendLine(`${i + 1}. ${item.label}`, true);
      appendLine(`   ${item.detail}`, false);
      appendLine(`   ${item.sourceNote}`, false);
      appendLine('', false);
    });
  }

  try {
    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          { insertText: { location: { index: 1 }, text: body } },
          ...boldRanges.map((r) => ({
            updateTextStyle: {
              range: { startIndex: r.start, endIndex: r.end },
              textStyle: { bold: true },
              fields: 'bold',
            },
          })),
        ],
      },
    });
  } catch (err) {
    throw new Error(`Doc created but could not write itinerary content: ${(err as Error).message}`);
  }

  return { documentId, url: `https://docs.google.com/document/d/${documentId}/edit` };
}

// tb-buyer-leads-match-itinerary-001 Decision (resolving the doc's open
// question): 'writer' access for the requesting agent specifically -- this
// is a working showing-day doc the agent is expected to annotate (times,
// notes) on the day itself, not a read-only handout, and it's shared with
// exactly one named person, not "anyone with the link", so 'writer' here is
// a per-user grant, not a public one. Falls back to an "anyone with the
// link can view" grant only if the agent has no resolvable email (keeps the
// doc reachable rather than silently unshared) -- this fallback is
// deliberately 'reader', not 'writer', since it's no longer scoped to one
// identity.
export async function shareItineraryDoc(documentId: string, agentEmail: string | null): Promise<void> {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  try {
    if (agentEmail) {
      await drive.permissions.create({
        fileId: documentId,
        sendNotificationEmail: false,
        requestBody: { type: 'user', role: 'writer', emailAddress: agentEmail },
      });
    } else {
      await drive.permissions.create({
        fileId: documentId,
        requestBody: { type: 'anyone', role: 'reader' },
      });
    }
  } catch (err) {
    throw new Error(`Doc created but could not be shared: ${(err as Error).message}`);
  }
}
