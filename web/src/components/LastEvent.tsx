// A small pill in the canvas corner showing the latest pipeline event. Click to open the full log.
import { Activity } from 'lucide-react';
import { actions, useStore } from '@/store';
import { cn } from '@/lib/utils';
import { ToneBadge } from './Tone';

export function LastEvent() {
  const last = useStore((s) => s.log[0]);
  if (!last) return null;
  return (
    <button
      type="button"
      onClick={() => actions.select('sent')}
      className={cn('absolute bottom-4 left-4 flex max-w-[calc(100%-560px)] items-center gap-2 rounded-full border bg-card/90 py-1.5 pl-2.5 pr-3 text-xs shadow-xs backdrop-blur transition-colors hover:bg-accent', last.warn && 'text-[var(--red-11)]')}
    >
      <Activity className="size-3.5 shrink-0 text-muted-foreground" />
      {last.bucket && <ToneBadge tone={last.bucket} />}
      {last.strong && <span className="shrink-0 font-medium">{last.strong}</span>}
      <span className="truncate text-muted-foreground">{last.text}</span>
    </button>
  );
}
