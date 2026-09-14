import { loadApplicationByToken } from "@/lib/parent";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings";
import { fetchSchoolLogo } from "@/lib/school-logo";
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

  // A parent may have two completed payments over time (admission at the
  // main step, study material paid separately later) — show the most recent
  // one rather than .maybeSingle(), which would throw once a second
  // completed row exists.
  const { data: payments } = await admin
    .from("payments")
    .select(
      "amount, currency, receipt, razorpay_payment_id, status, created_at, updated_at, includes_admission, includes_study_material, admission_amount, study_material_amount",
    )
    .eq("application_id", app.id)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1);
  const payment = payments?.[0];
  if (!payment) {
    return new Response("No completed payment found for this application.", { status: 404 });
  }
  const description =
    payment.includes_admission && payment.includes_study_material
      ? "Admission fee + Study material"
      : payment.includes_study_material
        ? "Study material"
        : "Admission fee";

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
  const logoBytes = await fetchSchoolLogo();
  const logoSrc = logoBytes ? `data:image/png;base64,${Buffer.from(logoBytes).toString("base64")}` : null;

  const row = (label: string, value: string) =>
    `<div class="row"><span class="k">${esc(label)}</span><span class="v">${value}</span></div>`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Payment Receipt</title>
<style>
  :root {
    --teal: #1b7e9a; --ink: #14323b; --grey: #5c727a; --green: #2f8f6b;
    --line: #e0e9ea; --soft: #eef3f3;
  }
  * { box-sizing: border-box; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    color: var(--ink); max-width: 720px; margin: 0 auto; padding: 0 28px 48px;
    line-height: 1.6; background: #fff;
  }
  .topbar { height: 6px; background: linear-gradient(90deg, var(--teal), var(--green)); margin: 0 -28px 28px; }
  .btn-row { display: flex; justify-content: flex-end; padding: 16px 0 0; }
  .btn {
    background: var(--teal); color: #fff; border: 0; padding: 10px 18px; border-radius: 8px;
    cursor: pointer; font-size: 14px; font-weight: 600; box-shadow: 0 1px 3px rgba(20,50,59,.2);
  }
  .letterhead { display: flex; align-items: center; gap: 16px; padding-bottom: 20px; border-bottom: 2px solid var(--ink); }
  .letterhead img { height: 56px; width: auto; }
  .school-name { font-size: 20px; font-weight: 700; color: var(--ink); }
  .school-sub { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--grey); }
  .contact { margin-left: auto; text-align: right; font-size: 12.5px; color: var(--grey); }
  .contact a { color: var(--teal); text-decoration: none; }
  h1 { font-size: 26px; margin: 28px 0 2px; color: var(--ink); }
  .doc-meta { font-size: 13px; color: var(--grey); margin-bottom: 4px; }
  .paid { display: inline-flex; align-items: center; gap: 6px; margin: 16px 0 24px; padding: 7px 14px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 999px; color: #065f46; font-size: 13px; font-weight: 600; }
  .panel { background: var(--soft); border: 1px solid var(--line); border-radius: 10px; padding: 6px 18px; }
  .row { display: flex; justify-content: space-between; gap: 16px; padding: 10px 0; border-bottom: 1px solid var(--line); font-size: 14px; }
  .row:last-child { border-bottom: 0; }
  .k { color: var(--grey); flex: 0 0 42%; }
  .v { font-weight: 600; text-align: right; }
  .mono { font-family: ui-monospace, monospace; font-size: 12.5px; font-weight: 500; }
  .total { margin-top: 4px; padding-top: 14px; border-top: 1px solid var(--ink); }
  .total .k { color: var(--ink); font-weight: 600; }
  .total .v { font-size: 19px; color: var(--teal); }
  .foot { margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--line); font-size: 11.5px; color: var(--grey); display: flex; justify-content: space-between; }
  @media print {
    .noprint { display: none; }
    .topbar { margin-top: 0; }
    body { padding: 0 24px 24px; }
  }
</style></head>
<body>
  <div class="topbar noprint"></div>

  <div class="letterhead">
    ${logoSrc ? `<img src="${logoSrc}" alt="${esc(s.schoolName)}" />` : ""}
    <div>
      <div class="school-name">${esc(s.schoolName)}</div>
      <div class="school-sub">Payment Receipt</div>
    </div>
    <div class="contact">
      <a href="tel:${esc(s.schoolPhone.replace(/\s+/g, ""))}">${esc(s.schoolPhone)}</a><br/>
      <a href="mailto:${esc(s.schoolEmail)}">${esc(s.schoolEmail)}</a>
    </div>
  </div>

  <div class="btn-row noprint">
    <button class="btn" onclick="window.print()">Print / Save as PDF</button>
  </div>

  <h1>Payment Receipt</h1>
  <div class="doc-meta">Receipt no. ${esc(payment.receipt ?? "—")}</div>
  <div class="paid">✓ Payment received</div>

  <div class="panel">
    ${row("Payment ID", `<span class="mono">${esc(payment.razorpay_payment_id ?? "—")}</span>`)}
    ${row("Date & time", paidOn ? formatDateTime(paidOn) : "—")}
    ${row("Student's name", esc(student?.full_name ?? "—"))}
    ${row("Date of birth", student ? formatDate(student.dob) : "—")}
    ${row("Parent / guardian", esc(parent.full_name))}
    ${row("Admission number", esc(app.admission_number ?? "—"))}
    ${row("Class & section", esc(sectionLabel))}
    ${row("Description", esc(description))}
    ${
      payment.includes_admission && payment.includes_study_material
        ? row("Admission fee", formatINR(payment.admission_amount)) +
          row("Study material", formatINR(payment.study_material_amount))
        : ""
    }
    <div class="row total"><span class="k">Amount paid</span><span class="v">${formatINR(payment.amount)}</span></div>
  </div>

  <div class="foot">
    <span>This is a computer-generated receipt and does not require a signature.</span>
    <span>Ref: ${app.id}</span>
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
