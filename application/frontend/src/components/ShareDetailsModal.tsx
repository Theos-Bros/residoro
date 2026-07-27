import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchShareText, type ShareAudience } from '@/lib/shareTextApi';
import { logShareEvent } from '@/lib/analyticsApi';
import { RichTextEditor } from '@/components/RichTextEditor';
import { FloatingPanel } from '@/components/FloatingPanel';
import { Button } from '@/components/ui/button';

type Props = {
  session: Session;
  listingId: string;
  propertyTitle: string;
  onClose: () => void;
};

const AUDIENCES: { id: ShareAudience; label: string }[] = [
  { id: 'public', label: 'Public' },
  { id: 'co_broker', label: 'Co-broker' },
  { id: 'internal', label: 'Internal' },
];

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Internal audience returns plain \n-separated lines (fixed format, not a
// stored template) -- wrapped into <p> tags so the same rich-text editor
// used for Public/Co-broker can display/edit it consistently.
function linesToHtml(text: string): string {
  return text
    .split('\n')
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');
}

function htmlToPlainText(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent ?? '';
}

// tb-distribution-share-text-001: reuses FloatingPanel (this codebase's
// existing modal-equivalent, see ListingHistoryPanel) rather than
// introducing a new Dialog primitive, widened via className for the
// audience picker + rich-text editor.
export function ShareDetailsModal({ session, listingId, propertyTitle, onClose }: Props) {
  const [audience, setAudience] = useState<ShareAudience>('public');
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setCopied(false);
    fetchShareText(session.access_token, listingId, audience)
      .then(({ text }) => {
        if (cancelled) return;
        setHtml(audience === 'internal' ? linesToHtml(text) : text);
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
  }, [session.access_token, listingId, audience]);

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
      return;
    }

    // tb-analytics-share-performance-001: best-effort telemetry -- the copy
    // itself already succeeded and is what matters to the agent, so a failed
    // log call is swallowed here (console only), never surfaced as an error.
    logShareEvent(session.access_token, listingId, audience).catch((err) => {
      console.error('Could not log share event', err);
    });
  }

  return (
    <FloatingPanel
      title={`Share Details — ${propertyTitle}`}
      onClose={onClose}
      className="max-w-lg sm:max-w-xl"
    >
      <div className="space-y-4">
        <div className="flex gap-1">
          {AUDIENCES.map((a) => (
            <Button
              key={a.id}
              type="button"
              size="sm"
              variant={audience === a.id ? 'default' : 'outline'}
              onClick={() => setAudience(a.id)}
            >
              {a.label}
            </Button>
          ))}
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

        {!loading && !error && (
          <>
            <RichTextEditor value={html} onChange={setHtml} className="max-h-64 overflow-y-auto" />
            <div className="flex items-center gap-3">
              <Button onClick={handleCopy}>Copy to clipboard</Button>
              {copied && <span className="text-sm text-muted-foreground">Copied.</span>}
            </div>
          </>
        )}
      </div>
    </FloatingPanel>
  );
}
