import { loadApplicationByToken } from "@/lib/parent";
import { config } from "@/lib/config";
import { getSettings } from "@/lib/settings";
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
  const s = await getSettings();
  const today = formatDate(new Date());

  const acceptedBanner = app.agreement_accepted
    ? `<div style="margin:16px 0;padding:10px 14px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;color:#065f46;font-size:14px;">
         ✓ Digitally accepted by <strong>${esc(app.agreement_signature ?? "")}</strong>${
           app.agreement_accepted_at ? " on " + formatDate(app.agreement_accepted_at) : ""
         }.
       </div>`
    : "";

  const signBlock = app.agreement_accepted
    ? `<div class="sign">
         <div>Digitally signed by ${esc(app.agreement_signature ?? "")}<br/>
           <span class="muted">${app.agreement_accepted_at ? formatDate(app.agreement_accepted_at) : ""}</span>
         </div>
         <div>For the School</div>
       </div>`
    : `<div class="sign">
         <div>Parent / Guardian signature</div>
         <div>For the School</div>
       </div>`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Admission Agreement</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; color:#0f172a; max-width:720px; margin:40px auto; padding:0 24px; line-height:1.6; }
  h1 { font-size:24px; margin-bottom:4px; }
  h2 { font-size:16px; margin:32px 0 4px; padding-bottom:8px; border-bottom:1px solid #e2e8f0; }
  .muted { color:#64748b; }
  table { width:100%; border-collapse:collapse; margin:24px 0; }
  td { padding:8px 0; border-bottom:1px solid #e2e8f0; vertical-align:top; }
  td.k { color:#64748b; width:40%; }
  .terms { font-size:14.5px; color:#1e293b; }
  .terms p { margin:0 0 14px; }
  .terms p:last-child { margin-bottom:0; }
  .terms strong { display:block; margin-bottom:2px; color:#0f172a; }
  .sign { margin-top:48px; display:flex; justify-content:space-between; }
  .sign div { width:45%; border-top:1px solid #0f172a; padding-top:8px; }
  @media print { .noprint { display:none; } body { margin:0; } }
  .btn { background:#4f46e5; color:#fff; border:0; padding:10px 16px; border-radius:8px; cursor:pointer; }
</style></head>
<body>
  <button class="btn noprint" onclick="window.print()">Print / Save as PDF</button>
  <h1>Admission Agreement</h1>
  <div class="muted">${esc(s.schoolName)} · ${today}</div>
  <div class="muted"><a href="tel:${esc(s.schoolPhone.replace(/\s+/g, ""))}">${esc(s.schoolPhone)}</a> · <a href="mailto:${esc(s.schoolEmail)}">${esc(s.schoolEmail)}</a></div>
  ${acceptedBanner}
  <p>This agreement records the admission of the student named below for the
  academic year ${config.admission.year}, subject to the school's policies and
  payment of the admission fee.</p>
  <table>
    <tr><td class="k">Student name</td><td>${esc(student?.full_name ?? "—")}</td></tr>
    <tr><td class="k">Date of birth</td><td>${student ? formatDate(student.dob) : "—"}</td></tr>
    <tr><td class="k">Category</td><td>${esc(app.category ?? "—")}</td></tr>
    <tr><td class="k">Grade applying</td><td>${esc(app.grade_applying ?? "—")}</td></tr>
    <tr><td class="k">Curriculum</td><td>${esc(student?.curriculum ?? "—")}</td></tr>
    <tr><td class="k">Parent / guardian</td><td>${esc(parent.full_name)}</td></tr>
    <tr><td class="k">Contact</td><td>${esc(parent.phone)}${parent.email ? " · " + esc(parent.email) : ""}</td></tr>
    <tr><td class="k">Admission fee</td><td>${formatINR(s.feePaise)}</td></tr>
    <tr><td class="k">Application reference</td><td>${app.id}</td></tr>
  </table>
  <h2>Terms &amp; Conditions</h2>
  <div class="terms">${renderTerms(s.agreementTerms)}</div>
  ${signBlock}
</body></html>`;

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

// Renders the admin-edited terms text (a plain textarea value) as proper
// paragraphs instead of one collapsed block — blank lines split paragraphs,
// and a short first line matching "N) Heading" is bolded as that
// paragraph's heading. The length guard keeps a long line (a heading typed
// with no break before its body text) from being bolded whole.
function renderTerms(raw: string): string {
  const blocks = raw
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  return blocks
    .map((block) => {
      const lines = block.split("\n");
      const isHeading = /^\d+\)/.test(lines[0]) && lines[0].length < 60;
      if (isHeading) {
        const rest = lines.slice(1).map(esc).join("<br/>");
        return `<p><strong>${esc(lines[0])}</strong>${rest}</p>`;
      }
      return `<p>${lines.map(esc).join("<br/>")}</p>`;
    })
    .join("\n");
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
