// Right-hand panel: what is behind the selected node.
import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { nodeById } from '@/flow/graph';
import type { Bucket, Snapshot, SourceId } from '@/lib/api';
import { actions, sourceNode, useStore, type ItemRec, type LogLine } from '@/store';
import { cn } from '@/lib/utils';
import { Queue } from './Queue';
import { SourcePanel } from './SourcePanel';
import { Empty, RecentList } from './Recent';
import { ToneBadge } from './Tone';

const BUCKET_IDS = new Set(['ignore', 'faq', 'sales', 'support', 'escalate', 'unsure']);
const SOURCE_KEY: Record<string, SourceId> = { gmail: 'gmail', typeform: 'typeform', slack: 'slack', discord: 'discord', x: 'x' };

export function Inspector() {
  const selected = useStore((s) => s.selected);
  const snap = useStore((s) => s.snapshot);
  const n = selected ? nodeById(selected) : undefined;
  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col border-l bg-background">
      <div className="flex items-start gap-3 border-b px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium tracking-tight">{n ? n.label : 'Overview'}</h2>
          <p className="text-xs text-muted-foreground">{n ? n.sub : 'Filter first, write agents second.'}</p>
        </div>
        {n && <ToneBadge tone={n.tone ?? 'ignore'} className={cn(!n.tone && 'invisible')} />}
      </div>
      <ScrollArea className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:block!">
        <div className="w-full min-w-0 px-5 py-4">
          {!snap ? <Empty>Connecting…</Empty> : !n ? <Overview snap={snap} /> : <Panel id={n.id} snap={snap} />}
        </div>
      </ScrollArea>
    </aside>
  );
}

// ── panels ─────────────────────────────────────────────────────────────
function Overview({ snap }: { snap: Snapshot }) {
  const counts = useStore((s) => s.counts);
  const log = useStore((s) => s.log);
  const decided = (['faq', 'sales', 'support', 'escalate', 'unsure', 'ignore'] as Bucket[]).map((b) => [b, counts[b] ?? 0] as const);
  const total = decided.reduce((a, [, n]) => a + n, 0);
  return (
    <div className="space-y-5">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Messages arrive from the sources on the left. <b className="font-medium text-foreground">Jev</b> sorts each one into a bucket with one call. Only the matched bucket runs a write agent.
        {snap.config.mode === 'review' ? <> In review mode every customer-facing reply waits in <b className="font-medium text-foreground">Needs you</b>.</> : <> Auto mode is on: replies go out without asking.</>}
      </p>
      <Section title="This session">
        <div className="rounded-lg border bg-card">
          <div className="flex items-baseline gap-2 border-b px-3 py-2.5">
            <span className="text-xl font-medium tabular-nums tracking-tight">{total}</span>
            <span className="text-xs text-muted-foreground">decided</span>
            <span className="ml-auto text-xs text-muted-foreground">{counts['needs-you'] ?? 0} waiting</span>
          </div>
          <ul className="divide-y">
            {decided.map(([b, c]) => (
              <li key={b} className="flex items-center gap-2 px-3 py-1.5">
                <ToneBadge tone={b} dot />
                <div className="mx-1 h-1 flex-1 overflow-hidden rounded-full bg-muted"><div className={`tone-${b} h-full rounded-full bg-[var(--tone-solid)]`} style={{ width: total ? `${(c / total) * 100}%` : 0 }} /></div>
                <span className="w-6 text-right font-mono text-[11px] tabular-nums text-muted-foreground">{c}</span>
              </li>
            ))}
          </ul>
        </div>
      </Section>
      <Section title="Activity"><Log lines={log.slice(0, 12)} /></Section>
      <p className="text-[11px] text-muted-foreground">Click any node for what is behind it. Use the bar at the bottom to push a message through.</p>
    </div>
  );
}

function Panel({ id, snap }: { id: string; snap: Snapshot }) {
  const items = useStore((s) => s.items);
  const order = useStore((s) => s.order);
  const all = order.map((i) => items[i]).filter(Boolean);
  const recent = (pred: (r: ItemRec) => boolean, limit = 8) => all.filter(pred).slice(-limit).reverse();

  if (SOURCE_KEY[id]) return <SourcePanel key={id} id={SOURCE_KEY[id]} snap={snap} recent={recent((r) => sourceNode(r.item) === id)} />;
  if (id === 'test') return <Stack><p className="text-xs leading-relaxed text-muted-foreground">Type in the bar at the bottom. It runs Jev and the write agents for real, and nothing leaves this machine.</p><Section title="Recent"><RecentList items={recent((r) => !!r.item.test)} /></Section></Stack>;
  if (id === 'jev') return <JevPanel snap={snap} />;
  if (BUCKET_IDS.has(id)) return <Stack><p className="text-xs leading-relaxed">{snap.criteria[id] ?? 'Confidence too low, or the FAQ turned out not to cover it. Waits for you.'}</p><Section title="Recent"><RecentList items={recent((r) => r.decision?.bucket === id)} /></Section></Stack>;
  if (id.startsWith('agent-')) return <AgentPanel bucket={id.slice(6) as Bucket} snap={snap} recent={recent((r) => r.decision?.bucket === id.slice(6))} />;
  if (id === 'needs-you') return <Queue />;
  return <LogPanel />;
}

function JevPanel({ snap }: { snap: Snapshot }) {
  const [floor, setFloor] = useState(snap.config.confidenceFloor);
  return (
    <Stack>
      <Props rows={[['Model', <code className="font-mono">{snap.config.jevModel}</code>], ['Per message', 'One call: a Choice over the buckets, plus "does the FAQ cover it" and "is an automatic reply risky".']]} />
      <Section title="Gates in code">
        <div className="rounded-lg border bg-card px-3 py-2.5 text-xs">
          <div className="flex items-center gap-3">
            <span>Confidence below <b className="font-mono font-medium">{floor.toFixed(2)}</b> → unsure</span>
            <input type="range" min={0} max={1} step={0.05} value={floor} onChange={(e) => setFloor(Number(e.target.value))} onMouseUp={() => void actions.setFloor(floor)} onTouchEnd={() => void actions.setFloor(floor)} onKeyUp={() => void actions.setFloor(floor)} className="ml-auto w-28 accent-[var(--blue-9)]" />
          </div>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            <li>FAQ chosen but the FAQ does not cover it → unsure</li>
            <li>Risky to auto-reply ≥ 70% → escalate</li>
          </ul>
        </div>
      </Section>
      <Section title="Criteria Jev reads">
        <ul className="divide-y rounded-lg border bg-card">
          {Object.entries(snap.criteria).map(([k, v]) => <li key={k} className="flex gap-3 px-3 py-2"><ToneBadge tone={k} className="mt-0.5 shrink-0" /><span className="text-xs leading-relaxed">{v}</span></li>)}
        </ul>
      </Section>
      <Section title="Knowledge"><Knowledge files={['business.md', 'faq.md']} /></Section>
    </Stack>
  );
}

function AgentPanel({ bucket, snap, recent }: { bucket: Bucket; snap: Snapshot; recent: ItemRec[] }) {
  const what = bucket === 'escalate' ? <>Writes a careful reply to the person: takes it seriously, asks for what is needed, and promises nothing. It never goes out on its own, not even in auto mode, so you read it first.</>
    : bucket === 'faq' ? 'Answers only from faq.md. If the FAQ does not cover it, says so instead of inventing.'
    : bucket === 'sales' ? <>Thanks them, answers from the FAQ, asks one question, offers {snap.config.bookingLink ? <a className="inline-flex items-center gap-0.5 font-mono underline-offset-2 hover:underline" href={snap.config.bookingLink} target="_blank" rel="noreferrer">{snap.config.bookingLink}<ExternalLink className="size-3" /></a> : 'a call'}. Never promises discounts.</>
    : 'Acknowledges, gives matching steps from support.md, asks for missing details. Never promises refunds or dates.';
  return (
    <Stack>
      <p className="text-xs leading-relaxed">{what}</p>
      <Props rows={[
        ['Tool', <code className="font-mono text-[11px]">{bucket === 'escalate' ? 'GMAIL_SEND_EMAIL → you' : 'GMAIL_REPLY_TO_THREAD · GMAIL_SEND_EMAIL · TWITTER_CREATION_OF_A_POST'}</code>],
        ['Model', <code className="font-mono text-[11px]">{snap.config.model}</code>],
        ['Mode', <>{snap.config.mode}{snap.config.mode === 'review' && bucket !== 'escalate' ? <span className="text-muted-foreground"> · drafts wait in Needs you</span> : ''}</>],
      ]} />
      {bucket === 'support' && <Section title="Knowledge"><Knowledge files={['support.md']} /></Section>}
      <Section title="Recent"><RecentList items={recent} /></Section>
    </Stack>
  );
}

function Knowledge({ files }: { files: string[] }) {
  const knowledge = useStore((s) => s.knowledge);
  if (!knowledge) return <Empty>Loading…</Empty>;
  return (
    <Tabs defaultValue={files[0]}>
      {files.length > 1 && <TabsList className="mb-2 h-8">{files.map((f) => <TabsTrigger key={f} value={f} className="font-mono text-[11px]">{f}</TabsTrigger>)}</TabsList>}
      {files.map((f) => <TabsContent key={f} value={f}><Editor file={f} initial={knowledge[f] ?? ''} /></TabsContent>)}
    </Tabs>
  );
}
function Editor({ file, initial }: { file: string; initial: string }) {
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(false);
  const dirty = text !== initial;
  return (
    <div className="space-y-2">
      <Textarea value={text} onChange={(e) => { setText(e.target.value); setSaved(false); }} className="autogrow min-h-40 max-h-96 font-mono text-[11.5px] leading-relaxed" spellCheck={false} />
      <div className="flex items-center gap-2">
        <Button size="sm" variant={dirty ? 'default' : 'outline'} disabled={!dirty} onClick={async () => { await actions.saveKnowledge(file, text); setSaved(true); }}>Save {file}</Button>
        <span className="text-[11px] text-muted-foreground">{saved ? 'Saved. Jev reads it on the next message.' : dirty ? 'Unsaved changes' : 'No restart needed'}</span>
      </div>
    </div>
  );
}

function LogPanel() {
  const log = useStore((s) => s.log);
  const lines = log;
  return <Stack><Section title="Activity"><Log lines={lines} /></Section></Stack>;
}

function Log({ lines }: { lines: LogLine[] }) {
  if (!lines.length) return <Empty>Nothing yet</Empty>;
  return (
    <ul className="divide-y rounded-lg border bg-card">
      {lines.map((l) => (
        <li key={l.id} className="flex items-start gap-2 px-3 py-2 text-xs">
          <span className="mt-px shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">{new Date(l.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          <span className={cn('min-w-0 flex-1', l.warn && 'text-[var(--red-11)]')}>
            {l.bucket && <ToneBadge tone={l.bucket} className="mr-1.5 align-text-bottom" />}
            {l.strong && <span className={cn('font-medium', l.ok && 'text-[var(--grass-11)]')}>{l.strong}{l.text ? ' · ' : ''}</span>}
            <span className={cn(!l.strong && !l.warn && 'text-muted-foreground')}>{l.text}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// ── layout helpers ─────────────────────────────────────────────────────
const Stack = ({ children }: { children: React.ReactNode }) => <div className="space-y-5">{children}</div>;
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-2"><h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{title}</h3>{children}</section>;
}
function Props({ rows }: { rows: ReadonlyArray<readonly [string, React.ReactNode]> }) {
  return (
    <dl className="divide-y rounded-lg border bg-card text-xs">
      {rows.map(([k, v]) => <div key={k} className="grid grid-cols-[88px_1fr] gap-3 px-3 py-2"><dt className="text-muted-foreground">{k}</dt><dd className="min-w-0 break-words leading-relaxed">{v}</dd></div>)}
    </dl>
  );
}
