// Plain SVG smooth-area "wave" sparkline — no charting library, no client
// JS. Pure markup from a number[], so it's just as safe to render from a
// Server Component as from a Client one. `id` only needs to be unique among
// sparklines on the same page (used to scope the gradient def).
export function Sparkline({
  values,
  id,
  className,
}: {
  values: number[];
  id: string;
  className?: string;
}) {
  if (values.length === 0) return null;

  const w = 100;
  const h = 28;
  const pad = 3;
  const max = Math.max(1, ...values);
  const yFor = (v: number) => h - pad - (v / max) * (h - pad * 2);

  const points =
    values.length === 1
      ? [
          { x: 0, y: yFor(values[0]) },
          { x: w, y: yFor(values[0]) },
        ]
      : values.map((v, i) => ({ x: (i / (values.length - 1)) * w, y: yFor(v) }));

  // Catmull-Rom -> cubic Bezier, for a smooth "wave" through every point
  // instead of sharp straight-line segments.
  let linePath = `M${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    linePath += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  const last = points[points.length - 1];
  const first = points[0];
  const areaPath = `${linePath} L${last.x},${h} L${first.x},${h} Z`;

  const allZero = values.every((v) => v === 0);
  const gradientId = `spark-grad-${id}`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity={allZero ? 0.06 : 0.38} />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
      <path
        d={linePath}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={1.5}
        strokeOpacity={allZero ? 0.25 : 0.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
