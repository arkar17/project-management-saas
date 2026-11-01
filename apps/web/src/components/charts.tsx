import type { BurndownDto, ReportRange } from '@pm/shared';

/** Horizontal bars; widths are relative to the largest value. Readable without colour. */
export function BarList({ items }: { items: { label: string; value: number; hint?: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.label} className="text-sm">
          <div className="flex justify-between gap-2">
            <span className="truncate">{i.label}</span>
            <span className="shrink-0 font-medium">
              {i.value}
              {i.hint && <span className="ml-1 text-xs font-normal text-muted">{i.hint}</span>}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${(i.value / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function RangeNote({ range }: { range: ReportRange }) {
  const span = range.from === range.to ? range.from : `${range.from} – ${range.to}`;
  return (
    <p className="text-xs text-muted">
      {span} · {range.timezone.replaceAll('_', ' ')} time
    </p>
  );
}

const W = 600;
const H = 220;
const PAD = { l: 32, r: 8, t: 8, b: 24 };

/**
 * Actual remaining committed points against the ideal line (FR-RPT-003). Inline SVG scales
 * with its container; the table below it carries the same numbers for screen readers.
 */
export function BurndownChart({ data }: { data: BurndownDto }) {
  const days = data.days;
  if (days.length === 0) return null;
  const max = Math.max(
    1,
    data.committedPoints,
    ...days.map((d) => d.remainingCommittedPoints ?? 0),
  );
  const x = (i: number) =>
    PAD.l + (days.length === 1 ? 0 : (i / (days.length - 1)) * (W - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const ideal = days.map((d, i) => `${x(i)},${y(d.idealPoints)}`).join(' ');
  const actual = days
    .map((d, i) =>
      d.remainingCommittedPoints === null ? null : `${x(i)},${y(d.remainingCommittedPoints)}`,
    )
    .filter(Boolean)
    .join(' ');
  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Sprint burndown chart"
      >
        <line
          x1={PAD.l}
          y1={y(0)}
          x2={W - PAD.r}
          y2={y(0)}
          stroke="currentColor"
          className="text-slate-200"
        />
        <text x={PAD.l - 6} y={y(max) + 4} textAnchor="end" className="fill-slate-500 text-[11px]">
          {max}
        </text>
        <text x={PAD.l - 6} y={y(0) + 4} textAnchor="end" className="fill-slate-500 text-[11px]">
          0
        </text>
        <polyline
          points={ideal}
          fill="none"
          strokeDasharray="4 4"
          strokeWidth={2}
          className="stroke-slate-400"
        />
        <polyline points={actual} fill="none" strokeWidth={2.5} className="stroke-primary" />
        {days.map((d, i) =>
          d.remainingCommittedPoints === null ? null : (
            <circle
              key={d.date}
              cx={x(i)}
              cy={y(d.remainingCommittedPoints)}
              r={3}
              className="fill-primary"
            />
          ),
        )}
        <text x={PAD.l} y={H - 6} className="fill-slate-500 text-[11px]">
          {days[0]!.date}
        </text>
        <text x={W - PAD.r} y={H - 6} textAnchor="end" className="fill-slate-500 text-[11px]">
          {days.at(-1)!.date}
        </text>
      </svg>
      <figcaption className="flex flex-wrap gap-4 text-xs text-muted">
        <span>
          <span className="mr-1 inline-block h-0.5 w-4 bg-primary align-middle" /> Remaining
          (actual)
        </span>
        <span>
          <span className="mr-1 inline-block h-0.5 w-4 border-t-2 border-dashed border-slate-400 align-middle" />{' '}
          Ideal
        </span>
      </figcaption>
    </figure>
  );
}
