import { loadApplicationByToken } from "@/lib/parent";
import { config } from "@/lib/config";
import { getSettings } from "@/lib/settings";
import { fetchSchoolLogo } from "@/lib/school-logo";
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
  const logoBytes = await fetchSchoolLogo();
  const logoSrc = logoBytes ? `data:image/png;base64,${Buffer.from(logoBytes).toString("base64")}` : null;

  const acceptedBanner = app.agreement_accepted
    ? `<div class="banner">
         ✓ Digitally accepted by <strong>${esc(app.agreement_signature ?? "")}</strong>${
           app.agreement_accepted_at ? " on " + formatDate(app.agreement_accepted_at) : ""
         }.
       </div>`
    : "";

  const signBlock = app.agreement_accepted
    ? `<div class="sign">
         <div><span class="sign-name">${esc(app.agreement_signature ?? "")}</span><br/>
           <span class="muted">Digitally signed${app.agreement_accepted_at ? " · " + formatDate(app.agreement_accepted_at) : ""}</span>
         </div>
         <div><span class="sign-name">${esc(s.schoolName)}</span><br/><span class="muted">For the School</span></div>
       </div>`
    : `<div class="sign">
         <div class="sign-blank">Parent / Guardian signature</div>
         <div class="sign-blank">For the School</div>
       </div>`;

  const row = (label: string, value: string) =>
    `<div class="row"><span class="k">${esc(label)}</span><span class="v">${value}</span></div>`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Admission Agreement</title>
<style>
  :root {
    --teal: #1b7e9a; --ink: #14323b; --grey: #5c727a; --green: #2f8f6b;
    --line: #e0e9ea; --soft: #eef3f3;
  }
  * { box-sizing: border-box; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    color: var(--ink); max-width: 780px; margin: 0 auto; padding: 0 28px 48px;
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
  .banner { margin: 18px 0; padding: 10px 14px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; color: #065f46; font-size: 14px; }
  .intro { font-size: 14.5px; color: var(--ink); margin: 18px 0 24px; }
  h2 { font-size: 15px; margin: 32px 0 12px; padding-bottom: 8px; border-bottom: 1px solid var(--line); color: var(--ink); }
  .panel { background: var(--soft); border: 1px solid var(--line); border-radius: 10px; padding: 6px 18px; }
  .row { display: flex; justify-content: space-between; gap: 16px; padding: 10px 0; border-bottom: 1px solid var(--line); font-size: 14px; }
  .row:last-child { border-bottom: 0; }
  .k { color: var(--grey); flex: 0 0 42%; }
  .v { font-weight: 600; text-align: right; }
  .fee-row .v { color: var(--teal); font-size: 16px; }
  .terms { font-size: 14.5px; color: var(--ink); }
  .terms p { margin: 0 0 14px; }
  .terms p:last-child { margin-bottom: 0; }
  .terms strong { display: block; margin-bottom: 2px; color: var(--ink); }
  .sign { margin-top: 56px; display: flex; justify-content: space-between; gap: 24px; }
  .sign > div { width: 46%; }
  .sign-blank { border-top: 1px solid var(--ink); padding-top: 8px; font-size: 13px; color: var(--grey); }
  .sign-name { font-size: 15px; font-weight: 600; border-top: 1px solid var(--ink); padding-top: 8px; display: inline-block; }
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
      <div class="school-sub">Admission Agreement</div>
    </div>
    <div class="contact">
      <a href="tel:${esc(s.schoolPhone.replace(/\s+/g, ""))}">${esc(s.schoolPhone)}</a><br/>
      <a href="mailto:${esc(s.schoolEmail)}">${esc(s.schoolEmail)}</a>
    </div>
  </div>

  <div class="btn-row noprint">
    <button class="btn" onclick="window.print()">Print / Save as PDF</button>
  </div>

  <h1>Admission Agreement</h1>
  <div class="doc-meta">Academic year ${config.admission.year} · Issued ${today}</div>
  ${acceptedBanner}
  <p class="intro">This agreement records the admission of the student named below for the
  academic year ${config.admission.year}, subject to the school's policies and
  payment of the admission fee.</p>

  <div class="panel">
    ${row("Student name", esc(student?.full_name ?? "—"))}
    ${row("Date of birth", student ? formatDate(student.dob) : "—")}
    ${row("Category", esc(app.category ?? "—"))}
    ${row("Grade applying", esc(app.grade_applying ?? "—"))}
    ${row("Preferred class timing", esc(app.preferred_class_timing ?? "No preference"))}
    ${row("Curriculum", esc(student?.curriculum ?? "—"))}
    ${row("PEN number", esc(student?.pen_number ?? "—"))}
    ${row("Parent / guardian", esc(parent.full_name))}
    ${row("Contact", esc(parent.phone) + (parent.email ? " · " + esc(parent.email) : ""))}
    <div class="row fee-row"><span class="k">Admission fee</span><span class="v">${formatINR(s.feePaise)}</span></div>
    ${row("Application reference", `<span style="font-weight:500;font-family:ui-monospace,monospace;font-size:12px;">${app.id}</span>`)}
  </div>

  <h2>Terms &amp; Conditions</h2>
  <div class="terms">${renderTerms(s.agreementTerms)}</div>

  ${signBlock}

  <div class="foot">
    <span>${esc(s.schoolName)} · Confidential — admission agreement, computer-generated.</span>
    <span>Ref: ${app.id}</span>
  </div>
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
