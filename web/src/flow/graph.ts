// The pipeline as a graph. Positions are a fixed left-to-right layout; React Flow's fitView scales it to the canvas.
import type { Bucket } from '@/lib/api';

export type NodeKind = 'source' | 'jev' | 'bucket' | 'agent' | 'outcome';
export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  sub: string;
  x: number;
  y: number;
  w: number;
  tone?: Bucket;
  icon: string; // lucide icon name, resolved in nodes.tsx
}

// Kept narrow on purpose: the canvas is wider than it is tall, so width decides the zoom. ~1040 wide lets fitView
// land near 1:1 in a typical 1080px canvas, with rows spread to use the height.
const X = { sources: 0, jev: 228, buckets: 476, agents: 704, out: 932 };
const W = { sources: 180, jev: 200, buckets: 180, agents: 180, out: 120 };
const ROW = 92;

export const GRAPH_NODES: GraphNode[] = [
  { id: 'gmail', kind: 'source', label: 'Gmail', sub: 'Trigger · new inbox mail', x: X.sources, y: -ROW * 0.5, w: W.sources, icon: 'Mail' },
  { id: 'typeform', kind: 'source', label: 'Typeform', sub: 'Trigger · new response', x: X.sources, y: ROW * 0.5, w: W.sources, icon: 'ClipboardList' },
  { id: 'slack', kind: 'source', label: 'Slack', sub: 'Trigger · DMs and channels', x: X.sources, y: ROW * 1.5, w: W.sources, icon: 'Hash' },
  { id: 'discord', kind: 'source', label: 'Discord', sub: 'Trigger · one channel', x: X.sources, y: ROW * 2.5, w: W.sources, icon: 'MessageCircle' },
  { id: 'x', kind: 'source', label: 'X mentions', sub: 'Polled every 5 min', x: X.sources, y: ROW * 3.5, w: W.sources, icon: 'AtSign' },
  { id: 'test', kind: 'source', label: 'Composer', sub: 'Typed below', x: X.sources, y: ROW * 4.7, w: W.sources, icon: 'FlaskConical' },
  { id: 'jev', kind: 'jev', label: 'Jev', sub: 'TypeSafe System One', x: X.jev, y: ROW * 2, w: W.jev, icon: 'Sparkles' },
  { id: 'ignore', kind: 'bucket', label: 'Ignore', sub: 'Nothing happens', x: X.buckets, y: -ROW * 0.5, w: W.buckets, tone: 'ignore', icon: 'EyeOff' },
  { id: 'faq', kind: 'bucket', label: 'FAQ', sub: 'Answer is in the FAQ', x: X.buckets, y: ROW * 0.5, w: W.buckets, tone: 'faq', icon: 'BookOpen' },
  { id: 'sales', kind: 'bucket', label: 'Sales', sub: 'Might buy', x: X.buckets, y: ROW * 1.5, w: W.buckets, tone: 'sales', icon: 'BadgeDollarSign' },
  { id: 'support', kind: 'bucket', label: 'Support', sub: 'Existing customer, problem', x: X.buckets, y: ROW * 2.5, w: W.buckets, tone: 'support', icon: 'LifeBuoy' },
  { id: 'escalate', kind: 'bucket', label: 'Escalate', sub: 'Risky to auto-reply', x: X.buckets, y: ROW * 3.5, w: W.buckets, tone: 'escalate', icon: 'TriangleAlert' },
  { id: 'unsure', kind: 'bucket', label: 'Unsure', sub: 'Jev is split', x: X.buckets, y: ROW * 4.5, w: W.buckets, tone: 'unsure', icon: 'CircleHelp' },
  { id: 'agent-faq', kind: 'agent', label: 'FAQ agent', sub: 'Replies from faq.md', x: X.agents, y: ROW * 0.5, w: W.agents, tone: 'faq', icon: 'Bot' },
  { id: 'agent-sales', kind: 'agent', label: 'Sales agent', sub: 'Reply + booking link', x: X.agents, y: ROW * 1.5, w: W.agents, tone: 'sales', icon: 'Bot' },
  { id: 'agent-support', kind: 'agent', label: 'Support agent', sub: 'Steps from support.md', x: X.agents, y: ROW * 2.5, w: W.agents, tone: 'support', icon: 'Bot' },
  { id: 'agent-escalate', kind: 'agent', label: 'Escalation agent', sub: 'Careful reply, always held', x: X.agents, y: ROW * 3.5, w: W.agents, tone: 'escalate', icon: 'Bot' },
  { id: 'needs-you', kind: 'agent', label: 'Needs you', sub: 'Drafts + unsure', x: X.agents, y: ROW * 4.7, w: W.agents, tone: 'unsure', icon: 'Inbox' },
  { id: 'sent', kind: 'outcome', label: 'Sent', sub: 'To the customer', x: X.out, y: ROW * 2.5, w: W.out, icon: 'Send' },
];

export const GRAPH_EDGES: [string, string][] = [
  ...(['gmail', 'typeform', 'slack', 'discord', 'x', 'test'] as const).map((s): [string, string] => [s, 'jev']),
  ...(['ignore', 'faq', 'sales', 'support', 'escalate', 'unsure'] as const).map((b): [string, string] => ['jev', b]),
  ['faq', 'agent-faq'], ['sales', 'agent-sales'], ['support', 'agent-support'], ['escalate', 'agent-escalate'], ['unsure', 'needs-you'],
  ['agent-faq', 'sent'], ['agent-sales', 'sent'], ['agent-support', 'sent'],
  ['agent-faq', 'needs-you'], ['agent-sales', 'needs-you'], ['agent-support', 'needs-you'],
  ['agent-escalate', 'needs-you'], ['needs-you', 'sent'],
];

export const COLUMNS: { x: number; w: number; label: string }[] = [
  { x: X.sources, w: W.sources, label: 'Sources' },
  { x: X.jev, w: W.jev, label: 'Filter' },
  { x: X.buckets, w: W.buckets, label: 'Buckets' },
  { x: X.agents, w: W.agents, label: 'Write agents' },
  { x: X.out, w: W.out, label: 'Outcome' },
];

export const nodeById = (id: string) => GRAPH_NODES.find((n) => n.id === id);
