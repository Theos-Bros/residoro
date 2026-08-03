import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchBroadcastText, type BroadcastEntityType } from '@/lib/broadcastApi';
import { RichTextEditor } from '@/components/RichTextEditor';
import { FloatingPanel } from '@/components/FloatingPanel';
import { Button } from '@/components/ui/button';

type Props = {
  session: Session;
  entityType: BroadcastEntityType;
  entityId: string;
  onClose: () => void;
};

function htmlToPlainText(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent ?? '';
}

// tb-buyer-leads-broadcast-001: a new component, not an extension of
// ShareDetailsModal -- that modal is listing-scoped with a 3-tab audience
// picker; a Buyer Wanted broadcast is single-tier and scoped to a buyer
// requirement (Inquiry or Lead), not a listing. Reuses only the
// clipboard-copy interaction mechanics (text/html + text/plain write,
// "copied" state), never calls logShareEvent() or any equivalent --
// cap-buyer-leads-001: "Does NOT track whether/when a Buyer Wanted broadcast
// was actually posted anywhere."
//
// Residoro Design Language (tb-design-system-modals-001): adds the
// mandatory description line under the title (FloatingPanel's `description`
// prop). Design doc section 10 illustrates an audience select + message
// textarea + "Send to N agents" footer button, but this component's actual
// flow is copy-to-clipboard, not a send/audience action -- it has no
// audience prop and no send callback, only a template body to copy. That
// content isn't invented here; the description instead states the real
// one-way/no-reply nature of a broadcast, and the existing Copy action is
// kept and restyled in place.
export function BroadcastModal({ session, entityType, entityId, onClose }: Props) {
  const [html, setHtml] = useState('');
  const [templateConfigured, setTemplateConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setCopied(false);
    fetchBroadcastText(session.access_token, entityType, entityId)
      .then(({ text, template_configured }) => {
        if (cancelled) return;
        setTemplateConfigured(template_configured);
        // mergeTemplate() substitutes fields into the tenant's own
        // RichTextEditor-authored template, which is already stored/returned
        // as HTML (matching ShareDetailsModal's public/co_broker branch) --
        // never plain text needing line-wrapping (that's only ShareDetails-
        // Modal's fixed, non-template-driven 'internal' audience).
        setHtml(text ?? '');
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session.access_token, entityType, entityId]);

  async function handleCopy() {
    const plainText = htmlToPlainText(html);
    try {
      if (navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([plainText], { type: 'text/plain' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plainText);
      }
      setCopied(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <FloatingPanel
      title="Broadcast to agents"
      description="A one-way announcement — agents can't reply. Use it for price changes, new inventory and deadlines, not conversations."
      onClose={onClose}
      className="max-w-lg sm:max-w-xl"
    >
      <div className="space-y-4">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

        {!loading && !error && !templateConfigured && (
          <p className="text-sm text-muted-foreground">
            No Buyer Wanted template configured yet. Set one up in Settings → Sharing Templates.
          </p>
        )}

        {!loading && !error && templateConfigured && (
          <>
            <RichTextEditor value={html} onChange={setHtml} className="max-h-64 overflow-y-auto" />
            <div className="flex items-center gap-3 border-t pt-4">
              <Button onClick={handleCopy}>Copy to clipboard</Button>
              {copied && <span className="text-sm text-muted-foreground">Copied.</span>}
            </div>
          </>
        )}
      </div>
    </FloatingPanel>
  );
}
