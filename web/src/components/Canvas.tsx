import { useMemo } from 'react';
import { Background, BackgroundVariant, Controls, ReactFlow, type NodeMouseHandler } from '@xyflow/react';
import { COLUMNS, GRAPH_EDGES, GRAPH_NODES } from '@/flow/graph';
import { nodeTypes, type PipelineNode } from '@/flow/nodes';
import { edgeTypes, type PulseEdge } from '@/flow/edges';
import { actions, useStore } from '@/store';
import { ToneBadge } from './Tone';

const SOURCE_KEY: Record<string, 'gmail' | 'typeform' | 'slack' | 'discord' | 'x'> = { gmail: 'gmail', typeform: 'typeform', slack: 'slack', discord: 'discord', x: 'x' };

export function Canvas() {
  const snap = useStore((s) => s.snapshot);
  const counts = useStore((s) => s.counts);
  const selected = useStore((s) => s.selected);
  const working = useStore((s) => s.working);
  const flash = useStore((s) => s.flash);
  const pulses = useStore((s) => s.pulses);
  const demo = !!snap?.stats.demo?.running;

  const nodes = useMemo<PipelineNode[]>(() => [
    // column labels are plain nodes too, so they pan and zoom with the graph
    ...COLUMNS.map((c, i) => ({ id: `col-${i}`, type: 'label' as const, position: { x: c.x, y: -84 }, data: { label: c.label, w: c.w }, draggable: false, selectable: false, focusable: false })),
    ...GRAPH_NODES.map((n) => {
      const key = SOURCE_KEY[n.id];
      const src = key && snap ? snap.config.sources[key] : undefined;
      const conn = key && snap ? snap.stats.connected?.[key] : undefined;
      // While a scripted run is playing every source is carrying messages, so they read as live rather than off.
      // Nothing on the canvas announces that the run is scripted.
      const status = key ? (demo ? 'ok' : !src?.enabled ? 'off' : conn === false ? 'err' : conn ? 'ok' : 'checking') : undefined;
      return {
        id: n.id, type: n.kind, position: { x: n.x, y: n.y },
        data: { ...n, count: counts[n.id] ?? 0, selected: selected === n.id, working: working.has(n.id), flash: flash.has(n.id), status, floor: snap?.config.confidenceFloor, model: snap?.config.jevModel },
        draggable: false, selectable: false, focusable: false,
      };
    }),
  ] as PipelineNode[], [snap, counts, selected, working, flash, demo]);

  const edges = useMemo<PulseEdge[]>(() => GRAPH_EDGES.map(([a, b]) => {
    const id = `${a}>${b}`;
    return { id, source: a, target: b, type: 'pulse' as const, data: { pulses: pulses.filter((p) => p.edge === id) }, focusable: false, selectable: false };
  }), [pulses]);

  const onNodeClick: NodeMouseHandler = (_, node) => { if (!node.id.startsWith('col-')) actions.select(node.id); };

  return (
    <div className="relative h-full w-full bg-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={{ ...nodeTypes, label: ColumnLabel }}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        onPaneClick={() => actions.select(null)}
        fitView
        // keep clear of the legend (top) and the floating composer (bottom)
        fitViewOptions={{ padding: { top: '44px', right: '24px', bottom: '104px', left: '24px' }, maxZoom: 1.2 }}
        minZoom={0.4}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll
        zoomOnScroll={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
        <Controls position="bottom-right" showInteractive={false} className="mb-3 mr-3" />
      </ReactFlow>
      <div className="pointer-events-none absolute left-4 top-3 z-[2] flex items-center gap-2">
        {(['faq', 'sales', 'support', 'escalate', 'unsure', 'ignore'] as const).map((t) => <ToneBadge key={t} tone={t} dot className="bg-card/80 backdrop-blur" />)}
      </div>
    </div>
  );
}

function ColumnLabel({ data }: { data: { label: string; w: number } }) {
  return (
    <div style={{ width: data.w }} className="border-b pb-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
      {data.label}
    </div>
  );
}
