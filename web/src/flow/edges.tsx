import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';
import type { Pulse } from '@/store';

export type PulseEdge = Edge<{ pulses: Pulse[] }, 'pulse'>;

const TONE_VAR: Record<string, string> = {
  faq: 'var(--blue-9)', sales: 'var(--grass-9)', support: 'var(--violet-9)', escalate: 'var(--red-9)', unsure: 'var(--amber-9)', ignore: 'var(--slate-9)',
  ok: 'var(--grass-9)', held: 'var(--violet-9)', primary: 'var(--blue-9)',
};

/** A bezier edge that can carry animated dots. Each pulse is a declarative SMIL animation; nothing to clean up. */
export function PulseEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<PulseEdge>) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.35 });
  const pulses = data?.pulses ?? [];
  const hot = pulses.length ? TONE_VAR[pulses[pulses.length - 1].tone] : undefined;
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: hot ?? 'var(--edge)', strokeWidth: hot ? 2 : 1.25, transition: 'stroke 200ms ease, stroke-width 200ms ease' }} />
      {pulses.map((p) => (
        <circle key={p.id} r={4} fill={TONE_VAR[p.tone]} style={{ filter: `drop-shadow(0 0 3px ${TONE_VAR[p.tone]})` }}>
          <animateMotion dur={`${p.ms}ms`} path={path} fill="freeze" calcMode="spline" keySplines="0.4 0 0.2 1" keyTimes="0;1" />
        </circle>
      ))}
    </>
  );
}

export const edgeTypes = { pulse: PulseEdgeView };
