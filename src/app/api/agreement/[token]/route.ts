import { loadApplicationByToken } from "@/lib/parent";
import { config } from "@/lib/config";
import { formatINR, formatDate } from "@/lib/utils";

// Auto-generated Admission Agreement (SRS FR-16), pre-filled with parent and
// student details. Rendered as printable HTML (use the browser's "Save as PDF").
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const { bundle } = await loadApplicationByToken(token);
  if (!bundle) return new Response("Agreement not found", { status: 404 });

  const { application: app, parent, student } = bundle;
  const today = formatDate(new Date());

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Admission Agreement</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; color:#0f172a; max-width:720px; margin:40px auto; padding:0 24px; line-height:1.6; }
  h1 { font-size:24px; margin-bottom:4px; }
  .muted { color:#64748b; }
  table { width:100%; border-collapse:collapse; margin:24px 0; }
  td { padding:8px 0; border-bottom:1px solid #e2e8f0; vertical-align:top; }
  td.k { color:#64748b; width:40%; }
  .sign { margin-top:48px; display:flex; justify-content:space-between; }
  .sign div { width:45%; border-top:1px solid #0f172a; padding-top:8px; }
  @media print { .noprint { display:none; } body { margin:0; } }
  .btn { background:#4f46e5; color:#fff; border:0; padding:10px 16px; border-radius:8px; cursor:pointer; }
</style></head>
<body>
  <button class="btn noprint" onclick="window.print()">Print / Save as PDF</button>
  <h1>Admission Agreement</h1>
  <div class="muted">Online School Admission Automation System · ${today}</div>
  <p>This agreement records the admission of the student named below for the
  academic year ${config.admission.year}, subject to the school's policies and
  payment of the admission fee.</p>
  <table>
    <tr><td class="k">Student name</td><td>${esc(student?.full_name ?? "—")}</td></tr>
    <tr><td class="k">Date of birth</td><td>${student ? formatDate(student.dob) : "—"}</td></tr>
    <tr><td class="k">Category</td><td>${esc(app.category ?? "—")}</td></tr>
    <tr><td class="k">Grade applying</td><td>${esc(app.grade_applying ?? "—")}</td></tr>
    <tr><td class="k">Parent / guardian</td><td>${esc(parent.full_name)}</td></tr>
    <tr><td class="k">Contact</td><td>${esc(parent.phone)}${parent.email ? " · " + esc(parent.email) : ""}</td></tr>
    <tr><td class="k">Admission fee</td><td>${formatINR(config.admission.feePaise)}</td></tr>
    <tr><td class="k">Application reference</td><td>${app.id}</td></tr>
  </table>
  <p>By proceeding with the payment, the parent/guardian accepts the terms of
  admission, the fee schedule, and the school's code of conduct.</p>
  <div class="sign">
    <div>Parent / Guardian signature</div>
    <div>For the School</div>
  </div>
</body></html>`;

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
