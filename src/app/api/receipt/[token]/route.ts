import { loadApplicationByToken } from "@/lib/parent";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings";
import { formatINR, formatDate, formatDateTime } from "@/lib/utils";

// Printable payment receipt for the parent (use the browser's "Save as PDF").
// Mirrors the agreement route's approach — a self-contained HTML page.
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const { bundle } = await loadApplicationByToken(token);
  if (!bundle) return new Response("Receipt not found", { status: 404 });

  const { application: app, parent, student } = bundle;
  const admin = createSupabaseAdminClient();

  const { data: payment } = await admin
    .from("payments")
    .select("amount, currency, receipt, razorpay_payment_id, status, created_at, updated_at")
    .eq("application_id", app.id)
    .eq("status", "completed")
    .maybeSingle();
  if (!payment) {
    return new Response("No completed payment found for this application.", { status: 404 });
  }

  let sectionLabel = "—";
  if (app.section_id) {
    const { data: section } = await admin
      .from("sections")
      .select("grade, name")
      .eq("id", app.section_id)
      .maybeSingle();
    if (section) sectionLabel = `${section.grade} — Section ${section.name}`;
  }

  const s = await getSettings();
  const paidOn = (payment.updated_at ?? payment.created_at) as string | null;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Payment Receipt</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; color:#0f172a; max-width:720px; margin:40px auto; padding:0 24px; line-height:1.6; }
  h1 { font-size:24px; margin-bottom:4px; }
  .muted { color:#64748b; }
  .paid { display:inline-block; margin:16px 0; padding:6px 12px; background:#ecfdf5; border:1px solid #a7f3d0; border-radius:999px; color:#065f46; font-size:13px; font-weight:600; }
  table { width:100%; border-collapse:collapse; margin:16px 0; }
  td { padding:8px 0; border-bottom:1px solid #e2e8f0; vertical-align:top; }
  td.k { color:#64748b; width:42%; }
  .total td { border-bottom:0; font-size:18px; font-weight:700; padding-top:16px; }
  .foot { margin-top:32px; font-size:12px; color:#64748b; }
  @media print { .noprint { display:none; } body { margin:0; } }
  .btn { background:#1b7e9a; color:#fff; border:0; padding:10px 16px; border-radius:8px; cursor:pointer; }
</style></head>
<body>
  <button class="btn noprint" onclick="window.print()">Print / Save as PDF</button>
  <h1>Payment Receipt</h1>
  <div class="muted">${esc(s.schoolName)}</div>
  <div class="muted"><a href="tel:${esc(s.schoolPhone.replace(/\s+/g, ""))}">${esc(s.schoolPhone)}</a> · <a href="mailto:${esc(s.schoolEmail)}">${esc(s.schoolEmail)}</a></div>
  <div class="paid">✓ Payment received</div>
  <table>
    <tr><td class="k">Receipt no.</td><td>${esc(payment.receipt ?? "—")}</td></tr>
    <tr><td class="k">Payment ID</td><td>${esc(payment.razorpay_payment_id ?? "—")}</td></tr>
    <tr><td class="k">Date</td><td>${paidOn ? formatDateTime(paidOn) : "—"}</td></tr>
    <tr><td class="k">Student name</td><td>${esc(student?.full_name ?? "—")}</td></tr>
    <tr><td class="k">Date of birth</td><td>${student ? formatDate(student.dob) : "—"}</td></tr>
    <tr><td class="k">Parent / guardian</td><td>${esc(parent.full_name)}</td></tr>
    <tr><td class="k">Admission number</td><td>${esc(app.admission_number ?? "—")}</td></tr>
    <tr><td class="k">Class &amp; section</td><td>${esc(sectionLabel)}</td></tr>
    <tr><td class="k">Description</td><td>Admission fee</td></tr>
    <tr class="total"><td class="k">Amount paid</td><td>${formatINR(payment.amount)}</td></tr>
  </table>
  <p class="foot">This is a computer-generated receipt and does not require a signature.
  Reference: ${app.id}</p>
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
