import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AppStatus } from "@/lib/types";

// Lightweight, dependency-free analytics for the admin overview. Charts are
// pure server-rendered SVG themed to the brand palette (teal / sage / amber /
// green / red). Native <title> tooltips give hover detail without client JS.

interface ChartRow {
  status: AppStatus;
  created_at: string;
}

// Funnel buckets shown in the donut, in display order. Each maps several raw
// statuses into one human-friendly stage.
const BUCKETS = [
  { key: "lead", label: "New leads", color: "#94ac9f" },
  { key: "assessment", label: "In assessment", color: "#1b7e9a" },
  { key: "payment", label: "Awaiting payment", color: "#c08a2d" },
  { key: "enrolled", label: "Enrolled", color: "#2f8f6b" },
  { key: "lost", label: "Rejected / lost", color: "#c0392b" },
  { key: "admin", label: "Needs admin", color: "#475569" },
] as const;

type BucketKey = (typeof BUCKETS)[number]["key"];

function bucketOf(status: AppStatus): BucketKey {
  switch (status) {
    case "LEAD_CREATED":
      return "lead";
    case "FORM_SUBMITTED":
    case "ASSESSMENT_SCHEDULED":
    case "ASSESSMENT_COMPLETED":
      return "assessment";
    case "AGREEMENT_SENT":
    case "PAYMENT_PENDING":
      return "payment";
    case "PAYMENT_COMPLETED":
    case "ENROLLED":
      return "enrolled";
    case "REJECTED":
    case "ABANDONED":
    case "PAYMENT_FAILED":
      return "lost";
    case "NEEDS_ADMIN":
      return "admin";
    default:
      return "lead";
  }
}

// Round a max value up to a "nice" axis bound (5, 10, 20, 50, …).
function niceCeil(n: number): number {
  if (n <= 5) return 5;
  const pow = Math.pow(10, Math.floor(Math.log10(n)));
  const f = n / pow;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * pow;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function AdmissionsCharts({ rows }: { rows: ChartRow[] }) {
  // ---- Status donut data ----
  const counts = new Map<BucketKey, number>();
  for (const r of rows) {
    const b = bucketOf(r.status);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  const total = rows.length;
  const legend = BUCKETS.map((b) => {
    const count = counts.get(b.key) ?? 0;
    return { ...b, count, pct: total ? Math.round((count / total) * 100) : 0 };
  });

  // ---- Monthly growth data (trailing 12 months) ----
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, idx) => {
    const i = 11 - idx;
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return {
      key: `${d.getFullYear()}-${d.getMonth()}`,
      month: d.getMonth(),
      year: d.getFullYear(),
      label: MONTHS_SHORT[d.getMonth()],
      total: 0,
      enrolled: 0,
    };
  });
  const monthIndex = new Map(months.map((m, i) => [m.key, i]));
  for (const r of rows) {
    const d = new Date(r.created_at);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const i = monthIndex.get(key);
    if (i === undefined) continue;
    months[i].total += 1;
    if (bucketOf(r.status) === "enrolled") months[i].enrolled += 1;
  }
  const totalEnrolled = months.reduce((a, m) => a + m.enrolled, 0);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle>Application status</CardTitle>
          <CardDescription>Where every applicant sits in the funnel.</CardDescription>
        </CardHeader>
        <CardContent>
          <StatusDonut total={total} legend={legend} />
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Admissions trend</CardTitle>
          <CardDescription>
            New applications per month over the last year · {totalEnrolled} enrolled.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GrowthBars months={months} />
        </CardContent>
      </Card>
    </div>
  );
}

function StatusDonut({
  total,
  legend,
}: {
  total: number;
  legend: { key: string; label: string; color: string; count: number; pct: number }[];
}) {
  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const R = 74;
  const stroke = 24;
  const circ = 2 * Math.PI * R;
  const gap = total > 1 ? 2.5 : 0; // small visual gap between segments

  let acc = 0;
  const segments = legend
    .filter((s) => s.count > 0)
    .map((s) => {
      const frac = s.count / total;
      const dash = frac * circ;
      const len = Math.max(dash - gap, 0.01);
      const seg = (
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
          <svg viewBox={`0 0 ${size} ${size}`} width={170} height={170} role="img" aria-label="Application status breakdown">
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
              applications
            </text>
          </svg>
        )}
      </div>

      <ul className="w-full space-y-2">
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

function GrowthBars({
  months,
}: {
  months: { label: string; month: number; year: number; total: number; enrolled: number }[];
}) {
  const W = 680;
  const H = 260;
  const padL = 34;
  const padR = 10;
  const padT = 14;
  const padB = 40;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const colW = plotW / months.length;
  const barW = Math.min(colW * 0.56, 34);

  const max = Math.max(...months.map((m) => m.total), 0);
  const niceMax = niceCeil(max);
  const yFor = (v: number) => padT + plotH * (1 - v / niceMax);
  const ticks = [0, 1, 2, 3, 4].map((t) => (niceMax * t) / 4);

  const ENROLLED = "#2f8f6b";
  const OTHER = "#1b7e9a";

  return (
    <div className="space-y-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Monthly admissions trend">
        {/* gridlines + y labels */}
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={padL}
              x2={W - padR}
              y1={yFor(v)}
              y2={yFor(v)}
              style={{ stroke: "var(--border)" }}
              strokeWidth={1}
            />
            <text
              x={padL - 6}
              y={yFor(v) + 3.5}
              textAnchor="end"
              fontSize="10"
              style={{ fill: "var(--muted-foreground)" }}
            >
              {v}
            </text>
          </g>
        ))}

        {/* bars */}
        {months.map((m, i) => {
          const cx = padL + i * colW + colW / 2;
          const x = cx - barW / 2;
          const remaining = m.total - m.enrolled;
          const enrolledH = (m.enrolled / niceMax) * plotH;
          const remainingH = (remaining / niceMax) * plotH;
          const base = padT + plotH;
          const showYear = i === 0 || m.month === 0;
          return (
            <g key={m.year + "-" + m.month} className="transition-opacity hover:opacity-80">
              <title>{`${m.label} ${m.year} — ${m.total} application${m.total === 1 ? "" : "s"}, ${m.enrolled} enrolled`}</title>
              {/* invisible full-height hover target so empty months are hoverable */}
              <rect x={x} y={padT} width={barW} height={plotH} fill="transparent" />
              {remaining > 0 && (
                <rect x={x} y={base - enrolledH - remainingH} width={barW} height={remainingH} rx={3} fill={OTHER} />
              )}
              {m.enrolled > 0 && (
                <rect x={x} y={base - enrolledH} width={barW} height={enrolledH} rx={3} fill={ENROLLED} />
              )}
              <text x={cx} y={H - 22} textAnchor="middle" fontSize="10" style={{ fill: "var(--muted-foreground)" }}>
                {m.label}
              </text>
              {showYear && (
                <text x={cx} y={H - 9} textAnchor="middle" fontSize="9" style={{ fill: "var(--muted-foreground)", opacity: 0.7 }}>
                  {m.year}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="flex items-center justify-center gap-5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: OTHER }} aria-hidden />
          In progress
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: ENROLLED }} aria-hidden />
          Enrolled
        </span>
      </div>
    </div>
  );
}
