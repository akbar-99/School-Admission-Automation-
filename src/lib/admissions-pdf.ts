import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { STATUS_LABEL } from "@/lib/types";
import type { AdmissionsReportRow } from "@/lib/admissions-report";

// Brand palette (matches result-pdf.ts / the web theme).
const TEAL = rgb(0x1b / 255, 0x7e / 255, 0x9a / 255);
const INK = rgb(0x14 / 255, 0x32 / 255, 0x3b / 255);
const GREY = rgb(0x5c / 255, 0x72 / 255, 0x7a / 255);
const LINE = rgb(0xe0 / 255, 0xe9 / 255, 0xea / 255);
const SOFT = rgb(0xee / 255, 0xf3 / 255, 0xf3 / 255);

export interface AdmissionsReportPdfInput {
  schoolName: string;
  schoolPhone: string;
  schoolEmail: string;
  logo: Uint8Array | null;
  generatedAt: string; // already formatted
  filterSummary: string;
  rows: AdmissionsReportRow[];
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// Landscape A4 — a report table needs the width more than a single-record
// document like the assessment result PDF does.
export async function generateAdmissionsReportPdf(input: AdmissionsReportPdfInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle("Admissions Report");
  doc.setAuthor(input.schoolName);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const W = 841.89; // landscape A4
  const H = 595.28;
  const M = 40;
  const right = W - M;

  let page = doc.addPage([W, H]);
  let y = H - M;

  const text = (
    p: PDFPage,
    s: string,
    x: number,
    yy: number,
    size: number,
    f: PDFFont = font,
    color = INK,
  ) => p.drawText(s ?? "", { x, y: yy, size, font: f, color });

  // ---- Header: logo + school + contact ----
  if (input.logo) {
    try {
      const png = await doc.embedPng(input.logo);
      const h = 40;
      const w = (png.width / png.height) * h;
      page.drawImage(png, { x: M, y: y - h, width: w, height: h });
    } catch {
      // ignore bad image; fall back to text below
    }
  }
  text(page, input.schoolName, M + 100, y - 18, 16, bold, TEAL);
  text(page, `${input.schoolPhone}  ·  ${input.schoolEmail}`, M + 100, y - 34, 9, font, GREY);

  const title = "ADMISSIONS REPORT";
  text(page, title, right - bold.widthOfTextAtSize(title, 14), y - 16, 14, bold, INK);
  const genLine = `Generated: ${input.generatedAt}`;
  text(page, genLine, right - font.widthOfTextAtSize(genLine, 9), y - 30, 9, font, GREY);
  y -= 48;

  page.drawLine({ start: { x: M, y }, end: { x: right, y }, thickness: 1.5, color: TEAL });
  y -= 16;

  text(page, `Filters: ${input.filterSummary}`, M, y, 9.5, font, GREY);
  const countLabel = `${input.rows.length} record${input.rows.length === 1 ? "" : "s"}`;
  text(page, countLabel, right - font.widthOfTextAtSize(countLabel, 9.5), y, 9.5, bold, INK);
  y -= 22;

  // ---- Table ----
  const cols: {
    key: keyof AdmissionsReportRow | "status" | "createdAt" | "section";
    label: string;
    x: number;
    w: number;
  }[] = [
    { key: "studentName", label: "STUDENT", x: M, w: 140 },
    { key: "parentName", label: "PARENT", x: M + 140, w: 120 },
    { key: "parentPhone", label: "PHONE", x: M + 260, w: 85 },
    { key: "gradeApplying", label: "GRADE", x: M + 345, w: 55 },
    { key: "status", label: "STATUS", x: M + 400, w: 130 },
    { key: "admissionNumber", label: "ADM. NO.", x: M + 530, w: 100 },
    { key: "section", label: "SECTION", x: M + 630, w: 70 },
    { key: "createdAt", label: "CREATED", x: M + 700, w: right - (M + 700) },
  ];

  const headerRow = (yy: number) => {
    page.drawRectangle({ x: M, y: yy - 20, width: right - M, height: 20, color: TEAL });
    for (const c of cols) text(page, c.label, c.x + 6, yy - 14, 8.5, bold, rgb(1, 1, 1));
    return yy - 20;
  };
  y = headerRow(y);

  let zebra = false;
  for (const r of input.rows) {
    const rowH = 20;
    if (y - rowH < 60) {
      page = doc.addPage([W, H]);
      y = H - M;
      y = headerRow(y);
      zebra = false;
    }
    if (zebra) {
      page.drawRectangle({ x: M, y: y - rowH, width: right - M, height: rowH, color: SOFT });
    }
    zebra = !zebra;
    const baseY = y - 14;
    const cellText = (key: (typeof cols)[number]["key"]): string => {
      switch (key) {
        case "status":
          return STATUS_LABEL[r.status] ?? r.status;
        case "createdAt":
          return fmtDate(r.createdAt);
        case "gradeApplying":
          return r.gradeApplying ?? "—";
        case "admissionNumber":
          return r.admissionNumber ?? "—";
        case "section":
          return r.sectionGrade ? `${r.sectionGrade}-${r.sectionName}` : "—";
        default:
          return String(r[key as keyof AdmissionsReportRow] ?? "—");
      }
    };
    for (const c of cols) {
      let v = cellText(c.key);
      // Truncate to fit the column rather than wrap — keeps rows single-line.
      while (font.widthOfTextAtSize(v, 9) > c.w - 10 && v.length > 1) {
        v = v.slice(0, -2) + "…";
      }
      text(page, v, c.x + 6, baseY, 9, font, INK);
    }
    y -= rowH;
    page.drawLine({ start: { x: M, y }, end: { x: right, y }, thickness: 0.5, color: LINE });
  }

  // ---- Footer on every page ----
  for (const p of doc.getPages()) {
    const foot = `${input.schoolName} · Confidential — admissions report, computer-generated.`;
    p.drawText(foot, { x: M, y: 24, size: 7.5, font, color: GREY });
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
