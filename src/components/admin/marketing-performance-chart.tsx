// Same dependency-free, pure server-rendered SVG donut technique as
// AdmissionsCharts' StatusDonut — themed to the same brand palette, native
// <title> tooltips, no client JS.

const PALETTE = ["#1b7e9a", "#2f8f6b", "#c08a2d", "#94ac9f", "#c0392b", "#475569"];

export interface MarketingPerformanceSlice {
  id: string;
  name: string;
  leads: number;
}

export function MarketingPerformancePie({ data }: { data: MarketingPerformanceSlice[] }) {
  const total = data.reduce((n, d) => n + d.leads, 0);
  const legend = data
    .map((d, i) => ({
      ...d,
      color: PALETTE[i % PALETTE.length],
      pct: total ? Math.round((d.leads / total) * 100) : 0,
    }))
    .sort((a, b) => b.leads - a.leads);

  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const R = 74;
  const stroke = 24;
  const circ = 2 * Math.PI * R;
  const gap = legend.filter((s) => s.leads > 0).length > 1 ? 2.5 : 0;

  let acc = 0;
  const segments = legend
    .filter((s) => s.leads > 0)
    .map((s) => {
      const frac = s.leads / total;
      const dash = frac * circ;
      const len = Math.max(dash - gap, 0.01);
      const seg = (
        <circle
          key={s.id}
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
          <title>{`${s.name}: ${s.leads} lead${s.leads === 1 ? "" : "s"} (${s.pct}%)`}</title>
        </circle>
      );
      acc += dash;
      return seg;
    });

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative shrink-0">
        {total === 0 ? (
          <svg viewBox={`0 0 ${size} ${size}`} width={170} height={170} role="img" aria-label="No data">
            <circle cx={cx} cy={cy} r={R} fill="none" strokeWidth={stroke} style={{ stroke: "var(--muted)" }} />
            <text x={cx} y={cy + 4} textAnchor="middle" fontSize="13" style={{ fill: "var(--muted-foreground)" }}>
              No data yet
            </text>
          </svg>
        ) : (
          <svg
            viewBox={`0 0 ${size} ${size}`}
            width={170}
            height={170}
            role="img"
            aria-label="Leads by marketing team member"
          >
            <circle cx={cx} cy={cy} r={R} fill="none" strokeWidth={stroke} style={{ stroke: "var(--muted)" }} />
            <g transform={`rotate(-90 ${cx} ${cy})`}>{segments}</g>
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
              leads
            </text>
          </svg>
        )}
      </div>

      <ul className="w-full space-y-2">
        {legend.map((s) => (
          <li key={s.id} className="flex items-center gap-2.5 text-sm">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-foreground/80">{s.name}</span>
            <span className="w-6 text-right font-semibold tabular-nums">{s.leads}</span>
            <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{s.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
