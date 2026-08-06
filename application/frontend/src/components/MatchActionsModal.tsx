import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchMatchCopyText, generateItinerary, type MatchItemInput } from '@/lib/matchLogsApi';
import { FloatingPanel } from '@/components/FloatingPanel';
import { Button } from '@/components/ui/button';

type Props = {
  session: Session;
  leadId: string;
  items: MatchItemInput[];
  mode: 'copy' | 'itinerary';
  onClose: () => void;
};

// tb-buyer-leads-match-itinerary-001: shared modal shell for the two
// generate-on-demand actions (copy-as-text, generate-itinerary) -- both fetch
// once on open and render a single result, unlike ShareDetailsModal's
// audience-tab re-fetch loop. Kept as one component (mode-switched) rather
// than two near-identical files since the loading/error/FloatingPanel
// scaffolding is otherwise a full duplicate.
export function MatchActionsModal({ session, leadId, items, mode, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [docUrl, setDocUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const request =
      mode === 'copy'
        ? fetchMatchCopyText(session.access_token, leadId, items).then((r) => {
            if (!cancelled) setText(r.text);
          })
        : generateItinerary(session.access_token, leadId, items).then((r) => {
            if (!cancelled) setDocUrl(r.url);
          });
    request
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.access_token, leadId, mode]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <FloatingPanel
      title={mode === 'copy' ? 'Copy matched properties' : 'Showing itinerary'}
      description={
        mode === 'copy'
          ? 'Share-ready text for the properties you selected, built from your Public share template.'
          : 'A live Google Doc for showing day, created under the Residoro service account and shared with you.'
      }
      onClose={onClose}
      className="max-w-lg sm:max-w-xl"
    >
      <div className="space-y-4">
        {loading && <p className="text-sm text-muted-foreground">{mode === 'copy' ? 'Building text…' : 'Creating the doc…'}</p>}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {!loading && !error && mode === 'copy' && (
          <>
            <textarea
              readOnly
              value={text}
              rows={12}
              className="w-full rounded-md border border-input bg-background p-3 font-mono text-xs"
            />
            <div className="flex items-center gap-3">
              <Button onClick={handleCopy}>Copy to clipboard</Button>
              {copied && <span className="text-sm text-muted-foreground">Copied.</span>}
            </div>
          </>
        )}

        {!loading && !error && mode === 'itinerary' && docUrl && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">The itinerary doc is ready.</p>
            <a
              href={docUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Open in Google Docs
            </a>
          </div>
        )}
      </div>
    </FloatingPanel>
  );
}
