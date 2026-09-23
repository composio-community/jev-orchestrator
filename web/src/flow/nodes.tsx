import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { AtSign, BadgeDollarSign, BookOpen, Bot, CircleHelp, ClipboardList, EyeOff, FlaskConical, Hash, Inbox, LifeBuoy, Mail, MessageCircle, Send, Sparkles, TriangleAlert, UserRound, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GraphNode } from './graph';

const ICONS: Record<string, LucideIcon> = { Mail, ClipboardList, Hash, MessageCircle, AtSign, FlaskConical, Sparkles, EyeOff, BookOpen, BadgeDollarSign, LifeBuoy, TriangleAlert, CircleHelp, Bot, Inbox, Send, UserRound };

export type NodeData = Record<string, unknown> & GraphNode & {
  count: number;
  selected: boolean;
  working: boolean;
  flash: boolean;
  status?: 'off' | 'ok' | 'err' | 'checking';
  floor?: number;
  model?: string;
};
export type PipelineNode = Node<NodeData, 'source' | 'jev' | 'bucket' | 'agent' | 'outcome'>;

function Count({ n, tone }: { n: number; tone?: string }) {
  if (!n) return null;
  return (
    <span className={cn('ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-md border px-1.5 font-mono text-[11px] font-medium tabular-nums', tone ? `tone-${tone} border-[var(--tone-border)] bg-[var(--tone-bg)] text-[var(--tone-fg)]` : 'border-border bg-muted text-foreground')}>
      {n}
    </span>
  );
}

function Shell({ data, children, className }: { data: NodeData; children: React.ReactNode; className?: string }) {
  return (
    <div
      style={{ width: data.w }}
      className={cn(
        'group relative rounded-lg border bg-card text-card-foreground shadow-xs transition-[border-color,box-shadow] duration-150',
        data.tone && `tone-${data.tone}`,
        data.selected ? 'border-[var(--blue-8)] ring-[3px] ring-[var(--blue-5)]' : 'hover:border-ring/60',
        data.working && 'node-working border-[var(--tone-border)]',
        data.flash && 'node-flash',
        data.status === 'off' && 'opacity-50',
        className,
      )}
    >
      {children}
    </div>
  );
}

function Icon({ name, tone, className }: { name: string; tone?: string; className?: string }) {
  const I = ICONS[name] ?? Bot;
  return (
    <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-md border', tone ? 'border-[var(--tone-border)] bg-[var(--tone-bg)] text-[var(--tone-fg)]' : 'border-border bg-muted text-muted-foreground', className)}>
      <I className="size-3.5" strokeWidth={1.75} />
    </span>
  );
}

export function StandardNode({ data }: NodeProps<PipelineNode>) {
  const hasIn = data.kind !== 'source';
  const hasOut = data.kind !== 'outcome' && data.id !== 'ignore';
  return (
    <Shell data={data}>
      {hasIn && <Handle type="target" position={Position.Left} isConnectable={false} />}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <Icon name={data.icon} tone={data.tone} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium leading-tight">{data.label}</span>
            {data.kind === 'source' && data.status && data.status !== 'off' && (
              <span className={cn('size-1.5 shrink-0 rounded-full', data.status === 'ok' ? 'bg-[var(--grass-9)]' : data.status === 'err' ? 'bg-[var(--red-9)]' : 'bg-[var(--amber-9)]')} />
            )}
          </div>
          <div className="truncate text-[11px] leading-tight text-muted-foreground">{data.status === 'off' ? 'Not connected' : data.sub}</div>
        </div>
        <Count n={data.count} tone={data.tone} />
      </div>
      {hasOut && <Handle type="source" position={Position.Right} isConnectable={false} />}
    </Shell>
  );
}

export function JevNode({ data }: NodeProps<PipelineNode>) {
  return (
    <Shell data={data} className="border-[var(--blue-6)] bg-[var(--blue-2)] dark:bg-card">
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="flex items-center gap-2.5 border-b border-[var(--blue-6)]/60 px-3 py-2.5">
        <Icon name="Sparkles" className="border-[var(--blue-7)] bg-[var(--blue-9)] text-white" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium leading-tight">Jev</div>
          <div className="truncate text-[11px] leading-tight text-muted-foreground">{data.sub}</div>
        </div>
        <Count n={data.count} tone="faq" />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 py-2.5 text-[11px] leading-tight">
        <dt className="text-muted-foreground">Returns</dt><dd className="text-foreground">Choice over 6 buckets</dd>
        <dt className="text-muted-foreground">Checks</dt><dd className="text-foreground">FAQ covers it · risky reply</dd>
        <dt className="text-muted-foreground">Floor</dt><dd className="font-mono tabular-nums text-foreground">{data.floor ?? 0.5}</dd>
        <dt className="text-muted-foreground">Model</dt><dd className="truncate font-mono text-foreground">{data.model ?? 'jev-latest'}</dd>
      </dl>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </Shell>
  );
}

export const nodeTypes = { source: StandardNode, jev: JevNode, bucket: StandardNode, agent: StandardNode, outcome: StandardNode };
