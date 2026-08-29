// Same dependency-free, pure server-rendered SVG donut technique as the
// admin charts — themed to the same brand palette (success green / danger
// red), native <title> tooltips, no client JS.

export function AssessmentOutcomeChart({ pass, fail }: { pass: number; fail: number }) {
  const total = pass + fail;
  const segments = [
    { key: "pass", label: "Pass", count: pass, color: "#2f8f6b" },
    { key: "fail", label: "Fail", count: fail, color: "#c0392b" },
  ];
  const legend = segments.map((s) => ({
    ...s,
    pct: total ? Math.round((s.count / total) * 100) : 0,
  }));

  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const R = 74;
  const stroke = 24;
  const circ = 2 * Math.PI * R;
  const gap = legend.filter((s) => s.count > 0).length > 1 ? 2.5 : 0;

  let acc = 0;
  const arcs = legend
    .filter((s) => s.count > 0)
    .map((s) => {
      const frac = s.count / total;
      const dash = frac * circ;
      const len = Math.max(dash - gap, 0.01);
      const arc = (
        <circle
          key={s.key}
          cx={cx}
          cy={cy}
          r={R}
          fill="none"
          stroke={s.color}
          strokeWidth={stroke}
          strokeLinecap="butt"
          strokeDasharray={`${len} ${circ - len}`}
          strokeDashoffset={-acc}
        >
          <title>{`${s.label}: ${s.count} (${s.pct}%)`}</title>
        </circle>
      );
      acc += dash;
      return arc;
    });

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:justify-center sm:gap-8">
      <div className="relative shrink-0">
        {total === 0 ? (
          <svg viewBox={`0 0 ${size} ${size}`} width={170} height={170} role="img" aria-label="No results yet">
            <circle cx={cx} cy={cy} r={R} fill="none" strokeWidth={stroke} style={{ stroke: "var(--muted)" }} />
            <text x={cx} y={cy + 4} textAnchor="middle" fontSize="13" style={{ fill: "var(--muted-foreground)" }}>
              No results yet
            </text>
          </svg>
        ) : (
          <svg
            viewBox={`0 0 ${size} ${size}`}
            width={170}
            height={170}
            role="img"
            aria-label="Pass/fail breakdown"
          >
            <circle cx={cx} cy={cy} r={R} fill="none" strokeWidth={stroke} style={{ stroke: "var(--muted)" }} />
            <g transform={`rotate(-90 ${cx} ${cy})`}>{arcs}</g>
            <text
              x={cx}
              y={cy - 4}
              textAnchor="middle"
              fontSize="34"
              fontWeight={700}
              className="font-display"
              style={{ fill: "var(--foreground)" }}
            >
              {total}
            </text>
            <text x={cx} y={cy + 18} textAnchor="middle" fontSize="12" style={{ fill: "var(--muted-foreground)" }}>
              assessed
            </text>
          </svg>
        )}
      </div>

      <ul className="w-full max-w-40 space-y-2">
        {legend.map((s) => (
          <li key={s.key} className="flex items-center gap-2.5 text-sm">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-foreground/80">{s.label}</span>
            <span className="w-6 text-right font-semibold tabular-nums">{s.count}</span>
            <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{s.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
