import { readFileSync } from 'node:fs';
import { google } from 'googleapis';

// tb-buyer-leads-match-itinerary-001: residoro's first external third-party
// API integration. Real googleapis-based Docs/Drive client, per the tracer
// bullet's explicit Decision #3/#4 -- a live Google Doc created under ONE
// shared Residoro-owned service account (not per-agent OAuth), then shared
// out to the requesting agent.
//
// Credential storage decision (tb-buyer-leads-itinerary-credential-path-001,
// superseding tb-buyer-leads-match-itinerary-001's original choice): a
// backend-only env var, GOOGLE_APPLICATION_CREDENTIALS, holding the
// filesystem path to a GCP service-account JSON key file -- loaded via
// google.auth.GoogleAuth({ keyFile }), the googleapis package's standard
// ADC-style loader, rather than the key's full JSON contents pasted as a
// one-line string into the env var itself. This keeps the raw key out of a
// routinely-read `.env` file; it is not a security boundary against anyone
// who already has shell access to the backend, since the key file still
// lives readably on the same disk. Everything else about where this
// backend reads credentials from (process.env via dotenv, not
// `vault.decrypted_secrets` -- see supabaseAdmin.ts, email.ts) is unchanged
// from the original decision.
//
// CREDENTIAL GAP (see tracer bullet doc + final report): this agent has no
// real GCP project/service account and cannot provision one. The user sets
// GOOGLE_APPLICATION_CREDENTIALS in application/backend/.env himself, to
// the absolute path of a JSON key file downloaded from a GCP service
// account (IAM & Admin > Service Accounts > Keys > Add key > JSON) that has
// the Google Docs API and Google Drive API enabled on its project, to
// finish verifying this end-to-end.

// tb-buyer-leads-itinerary-settings-001: widened from 'drive.file' to full
// 'drive' -- the template-copy/folder-targeting flow this tracer bullet adds
// reads and writes files the service account never created itself (an
// admin-authored template doc, an admin-owned Drive folder), only manually
// shared with the service account's own email via Drive's normal sharing UI.
// 'drive.file' only covers files the app itself created or that were opened
// through a Picker flow, neither of which applies here -- see this
// tracer bullet's semantic_scope for why manual sharing is a real,
// unavoidable prerequisite rather than something this feature can automate.
const SCOPES = ['https://www.googleapis.com/auth/documents', 'https://www.googleapis.com/auth/drive'];

export class GoogleDocsNotConfiguredError extends Error {
  constructor() {
    super(
      'GOOGLE_APPLICATION_CREDENTIALS is not set -- itinerary generation needs a real GCP service-account JSON key file path (see googleDocs.ts header comment).',
    );
    this.name = 'GoogleDocsNotConfiguredError';
  }
}

export function isGoogleDocsConfigured(): boolean {
  return !!process.env.GOOGLE_APPLICATION_CREDENTIALS;
}

function getAuth() {
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyFile) throw new GoogleDocsNotConfiguredError();

  return new google.auth.GoogleAuth({ keyFile, scopes: SCOPES });
}

let cachedServiceAccountEmail: string | null | undefined;

// tb-buyer-leads-itinerary-settings-001: the Settings UI needs to show the
// admin the exact address to manually share a template/folder with -- reads
// it straight out of the same key file getAuth() already points at, rather
// than asking the user to set a second env var that could drift from the
// real key. Cached after the first successful read since the key file's
// contents don't change at runtime.
export function getServiceAccountEmail(): string | null {
  if (cachedServiceAccountEmail !== undefined) return cachedServiceAccountEmail;

  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyFile) {
    cachedServiceAccountEmail = null;
    return null;
  }

  try {
    const key = JSON.parse(readFileSync(keyFile, 'utf-8')) as { client_email?: string };
    cachedServiceAccountEmail = key.client_email ?? null;
  } catch {
    cachedServiceAccountEmail = null;
  }
  return cachedServiceAccountEmail;
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
  // tb-buyer-leads-itinerary-settings-001: when set, generation copies this
  // template (via drive.files.copy + replaceAllText merge-fill) instead of
  // building plain text from scratch. folderId works independently of
  // templateDocumentId -- the template path passes it straight to
  // files.copy's `parents`, the plain-text path moves the doc into it with
  // a follow-up files.update (docs.documents.create has no parents option).
  templateDocumentId?: string | null;
  folderId?: string | null;
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
  if (input.templateDocumentId) {
    return createItineraryDocFromTemplate(input, input.templateDocumentId);
  }

  const result = await createItineraryDocFromScratch(input);
  if (input.folderId) {
    await moveDocToFolder(result.documentId, input.folderId);
  }
  return result;
}

// tb-buyer-leads-itinerary-settings-001: the merge-field template mechanism
// follows tb-distribution-share-text-001's mergeTemplate() philosophy
// applied to a Doc structure instead of a plain string. drive.files.copy
// reads the admin-authored template (only visible to the service account
// because the admin manually shared it -- see the SCOPES comment above),
// then docs.documents.batchUpdate's replaceAllText substitutes each
// {{merge_field}} token in one pass -- simpler and more robust to the
// admin's own formatting than character-index-based insertion.
async function createItineraryDocFromTemplate(
  input: CreateItineraryInput,
  templateDocumentId: string,
): Promise<CreateItineraryResult> {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  const docs = google.docs({ version: 'v1', auth });

  let documentId: string;
  try {
    const copied = await drive.files.copy({
      fileId: templateDocumentId,
      requestBody: {
        name: input.title,
        ...(input.folderId ? { parents: [input.folderId] } : {}),
      },
    });
    if (!copied.data.id) throw new Error('Google Drive API did not return a copied file id');
    documentId = copied.data.id;
  } catch (err) {
    throw new Error(`Could not copy the itinerary template: ${(err as Error).message}`);
  }

  const itemsTable =
    input.items.length === 0
      ? '(No matched items were selected for this itinerary.)'
      : input.items.map((item, i) => `${i + 1}. ${item.label} — ${item.detail} (${item.sourceNote})`).join('\n');

  const mergeFields: Record<string, string> = {
    title: input.title,
    buyer_name: input.buyerLabel,
    items_table: itemsTable,
  };

  try {
    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: Object.entries(mergeFields).map(([key, value]) => ({
          replaceAllText: {
            containsText: { text: `{{${key}}}`, matchCase: true },
            replaceText: value,
          },
        })),
      },
    });
  } catch (err) {
    throw new Error(`Itinerary doc copied from template but could not fill in its merge fields: ${(err as Error).message}`);
  }

  return { documentId, url: `https://docs.google.com/document/d/${documentId}/edit` };
}

// tb-buyer-leads-itinerary-settings-001: docs.documents.create has no
// `parents` option, so a folder-targeted plain-text doc needs this
// follow-up files.update -- reads the doc's current (default) parent so it
// can be removed in the same call, rather than leaving the doc visible in
// both its default location and the configured folder.
async function moveDocToFolder(documentId: string, folderId: string): Promise<void> {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  try {
    const file = await drive.files.get({ fileId: documentId, fields: 'parents' });
    const previousParents = (file.data.parents ?? []).join(',');
    await drive.files.update({
      fileId: documentId,
      addParents: folderId,
      ...(previousParents ? { removeParents: previousParents } : {}),
    });
  } catch (err) {
    throw new Error(`Doc created but could not be filed into the configured Drive folder: ${(err as Error).message}`);
  }
}

async function createItineraryDocFromScratch(input: CreateItineraryInput): Promise<CreateItineraryResult> {
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
// tb-buyer-leads-itinerary-settings-001: recipientEmail is a workspace-
// configured standing recipient, ADDED alongside the agent's own share, not
// a replacement -- confirmed explicitly during scoping, see this tracer
// bullet's semantic_scope. Uses the same 'writer' grant as the agent share
// (both are named individuals expected to annotate the doc, not "anyone
// with the link").
export async function shareItineraryDoc(
  documentId: string,
  agentEmail: string | null,
  recipientEmail?: string | null,
): Promise<void> {
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

    if (recipientEmail) {
      await drive.permissions.create({
        fileId: documentId,
        sendNotificationEmail: false,
        requestBody: { type: 'user', role: 'writer', emailAddress: recipientEmail },
      });
    }
  } catch (err) {
    throw new Error(`Doc created but could not be shared: ${(err as Error).message}`);
  }
}
