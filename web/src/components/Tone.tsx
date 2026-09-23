import { cn } from '@/lib/utils';

/** Bucket badge on the Radix tone scale: step 3 background, 7 border, 11 text. */
export function ToneBadge({ tone, children, className, dot }: { tone: string; children?: React.ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn(`tone-${tone}`, 'inline-flex h-5 items-center gap-1.5 rounded-md border border-[var(--tone-border)] bg-[var(--tone-bg)] px-1.5 font-mono text-[10.5px] font-medium uppercase tracking-wide text-[var(--tone-fg)]', className)}>
      {dot && <span className="size-1.5 rounded-full bg-[var(--tone-solid)]" />}
      {children ?? tone}
    </span>
  );
}
