import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { actions, useStore } from '@/store';

function StatusPill({ tone, children }: { tone: 'ok' | 'warn' | 'err' | 'idle'; children: React.ReactNode }) {
  const dot = { ok: 'bg-[var(--grass-9)]', warn: 'bg-[var(--amber-9)] animate-pulse', err: 'bg-[var(--red-9)]', idle: 'bg-muted-foreground/50' }[tone];
  return (
    <span className="inline-flex h-7 items-center gap-2 rounded-full border bg-card px-2.5 text-xs text-muted-foreground">
      <span className={cn('size-1.5 rounded-full', dot)} />
      {children}
    </span>
  );
}

export function TopBar() {
  const snap = useStore((s) => s.snapshot);
  const connection = useStore((s) => s.connection);
  const stream = snap?.stats.stream;
  const streamTone = connection === 'lost' ? 'err' : !snap ? 'warn' : !snap.configured ? 'idle' : stream === 'live' ? 'ok' : stream === 'standby' ? 'idle' : stream === 'connecting' || stream === 'reconnecting' ? 'warn' : stream === 'error' ? 'err' : 'idle';
  const streamText = connection === 'lost' ? 'Page lost the server' : !snap ? 'Connecting' : !snap.configured ? 'Not set up · run jev-orchestrator setup' : stream === 'live' ? `Live · ${snap.watching.join(', ')}` : stream === 'connecting' ? 'Connecting to Composio' : stream === 'reconnecting' ? 'Reconnecting' : stream === 'standby' ? `Another window is watching${snap.stats.watchedBy ? ` on ${snap.stats.watchedBy}` : ''}` : stream === 'error' ? 'Stream error' : 'Not watching';
  const mode = snap?.config.mode ?? 'review';

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-background px-4">
      <div className="flex items-center gap-2.5 pr-2">
        <span className="flex size-6 items-center justify-center rounded-md bg-[var(--blue-9)] text-white shadow-xs">
          <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 4h4l4 8h4" /><path d="M10 4h4" opacity=".55" /></svg>
        </span>
        <span className="text-[13px] font-medium tracking-tight">Jev</span>
        <span className="text-[13px] text-muted-foreground">Orchestrator</span>
      </div>
      <StatusPill tone={streamTone}>{streamText}</StatusPill>
      <div className="flex-1" />
      <Tabs value={mode} onValueChange={(v) => { if (v === 'auto' && !window.confirm('Auto mode sends FAQ, sales and support replies to real people without asking. Switch?')) return; void actions.setMode(v as 'review' | 'auto'); }}>
        <TabsList className="h-8">
          <TabsTrigger value="review" className="px-3 text-xs">Review</TabsTrigger>
          <TabsTrigger value="auto" className="px-3 text-xs data-[state=active]:text-[var(--amber-11)]">Auto</TabsTrigger>
        </TabsList>
      </Tabs>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={() => void actions.refresh()} aria-label="Re-check sources"><RefreshCw className="size-3.5" /></Button>
        </TooltipTrigger>
        <TooltipContent>Re-query connected accounts and triggers</TooltipContent>
      </Tooltip>
    </header>
  );
}
