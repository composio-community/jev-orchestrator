import { describe } from '@/lib/api';
import type { ItemRec } from '@/store';
import { ToneBadge } from './Tone';

const initials = (s: string) => s.replace(/<.*>/, '').trim().split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';

export function RecentList({ items, empty = 'Nothing yet' }: { items: ItemRec[]; empty?: string }) {
  if (!items.length) return <Empty>{empty}</Empty>;
  return (
    <ul className="divide-y rounded-lg border bg-card">
      {items.map((r) => (
        <li key={r.item.id} className="flex gap-3 px-3 py-2.5">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[10px] font-medium text-muted-foreground">{initials(r.item.from)}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-xs font-medium">{describe(r.item)}</span>
              <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">{new Date(r.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{r.item.subject ? `${r.item.subject}: ` : ''}{r.item.text}</p>
            {(r.decision || r.outcome) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                {r.decision && <ToneBadge tone={r.decision.bucket} />}
                {r.decision?.reason && <span className="truncate">{r.decision.reason}</span>}
                {r.outcome && <span className="font-mono text-[10px]">· {r.outcome}</span>}
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">{children}</div>;
}
