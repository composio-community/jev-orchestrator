// The needs-you pile, laid out like an agent task list: one row per item, status glyph left, meta right, editor inline.
import { useState } from 'react';
import { ArrowRight, Check, CheckCheck, Circle, CircleDashed, Copy, Loader2, Plug, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { BUCKETS, type Bucket, type InboxEntry, describe } from '@/lib/api';
import { actions, useStore } from '@/store';
import { cn } from '@/lib/utils';
import { Empty } from './Recent';
import { ToneBadge } from './Tone';

export function Queue() {
  const inbox = useStore((s) => s.inbox);
  const held = inbox.filter((e) => e.kind === 'held');
  const unsure = inbox.filter((e) => e.kind !== 'held');
  const sendable = held.filter((e) => !e.manual && e.bucket !== 'escalate');
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2">
        <Stat n={held.length} label="Drafts to approve" />
        <Stat n={unsure.length} label="Unsure to sort" />
      </div>
      {sendable.length > 1 && <SendAll count={sendable.length} />}
      {inbox.length === 0 ? <Empty>Nothing waiting. Drafts and unsure messages land here.</Empty> : (
        <div className="rounded-xl border bg-muted/40 p-1">
          <ul className="divide-y rounded-lg border bg-card">
            {[...inbox].reverse().map((e) => <Row key={e.id} entry={e} />)}
          </ul>
        </div>
      )}
    </div>
  );
}

function SendAll({ count }: { count: number }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
      <Button
        size="sm"
        disabled={busy}
        onClick={async () => {
          if (!window.confirm(`Send ${count} replies to real people now?`)) return;
          setBusy(true);
          const r = await actions.sendAll();
          setDone(r.sent ? `Sent ${r.sent}` : null);
          setBusy(false);
        }}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCheck className="size-3.5" />}
        Send all {count}
      </Button>
      <span className="text-[11px] text-muted-foreground">{done ?? 'Approves every draft that can go out from here'}</span>
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className="text-xl font-medium tabular-nums tracking-tight">{n}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function Row({ entry }: { entry: InboxEntry }) {
  const [open, setOpen] = useState(entry.kind === 'held');
  const [draft, setDraft] = useState(entry.draft);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const act = async (a: 'send' | 'done' | 'drop' | 'route' | 'ignore', body?: { text?: string; bucket?: Bucket }) => {
    setBusy(a + (body?.bucket ?? '')); setError(null);
    const err = await actions.inboxAct(entry.id, a, body);
    if (err) { setError(err); setBusy(null); }
  };
  const Glyph = busy ? Loader2 : entry.kind === 'held' ? Circle : CircleDashed;
  const alwaysHeld = entry.bucket === 'escalate'; // this one waits for a person whatever the mode says
  return (
    <li className="px-3 py-2.5">
      <button type="button" className="flex w-full items-start gap-2.5 text-left" onClick={() => setOpen((o) => !o)}>
        <Glyph className={cn('mt-0.5 size-4 shrink-0', busy ? 'animate-spin text-muted-foreground' : entry.kind === 'held' ? 'text-[var(--violet-11)]' : 'text-[var(--amber-11)]')} strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-xs font-medium">{describe(entry.item)}</span>
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{entry.kind !== 'held' ? 'needs a bucket' : entry.manual ? 'nothing connected to send it' : alwaysHeld ? 'needs your OK' : 'draft ready'}</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ToneBadge tone={entry.bucket} />
            <span className="truncate">{entry.reason}</span>
          </div>
        </div>
      </button>
      {open && (
        <div className="mt-2.5 min-w-0 space-y-2.5 pl-6.5">
          <blockquote className="max-h-28 overflow-auto whitespace-pre-wrap border-l-2 pl-2.5 text-xs text-muted-foreground">{entry.item.text}</blockquote>
          {entry.kind === 'held' ? (
            <>
              <div className="flex items-center gap-2 text-[10.5px] text-muted-foreground">
                <span className="font-mono">{entry.tool}{entry.to ? ` → ${entry.to}` : ''}</span>
                {alwaysHeld && <span className="italic">never goes out on its own</span>}
              </div>
              {alwaysHeld && entry.note && (
                <p className="rounded-md border border-[var(--red-7)] bg-[var(--red-3)] px-2.5 py-1.5 text-[11px] leading-relaxed text-[var(--red-11)]">{entry.note}</p>
              )}
              <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="autogrow min-h-24 max-h-72 font-mono text-xs leading-relaxed" />
              <div className="flex flex-wrap items-center gap-2">
                {entry.manual ? (
                  <>
                    <Button size="sm" onClick={() => actions.select(entry.channel === 'discord' ? 'discord' : entry.channel === 'x' ? 'x' : 'gmail')} disabled={!!busy}>
                      <Plug className="size-3.5" />Connect to send
                    </Button>
                    <Button size="sm" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(draft); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setError('could not copy; select the text instead'); } }} disabled={!!busy}><Copy className="size-3.5" />{copied ? 'Copied' : 'Copy'}</Button>
                    <Button size="sm" variant="ghost" onClick={() => act('done', { text: draft })} disabled={!!busy}><Check className="size-3.5" />Done</Button>
                  </>
                ) : (
                  <Button size="sm" onClick={() => act('send', { text: draft })} disabled={!!busy}><Check className="size-3.5" />Send</Button>
                )}
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => act('drop')} disabled={!!busy}><X className="size-3.5" />Drop</Button>
                {error && <span className="w-full truncate text-[11px] text-destructive">{error}</span>}
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              {entry.suggested && (
                <Button size="sm" className="h-7 gap-1 px-2 text-xs" disabled={!!busy} onClick={() => act('route', { bucket: entry.suggested as Bucket })}>
                  <Check className="size-3" />Run {entry.suggested}
                </Button>
              )}
              <span className="mr-1 text-[11px] text-muted-foreground">{entry.suggested ? 'or' : 'Route to'}</span>
              {BUCKETS.filter((b) => b !== 'unsure' && b !== entry.suggested).map((b) => (
                <Button key={b} size="sm" variant="outline" className={cn(`tone-${b}`, 'h-7 gap-1 px-2 text-xs hover:border-[var(--tone-border)] hover:bg-[var(--tone-bg)] hover:text-[var(--tone-fg)]')} disabled={!!busy} onClick={() => act(b === 'ignore' ? 'ignore' : 'route', b === 'ignore' ? undefined : { bucket: b })}>
                  {b}<ArrowRight className="size-3 opacity-50" />
                </Button>
              ))}
              {error && <span className="w-full text-[11px] text-destructive">{error}</span>}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
