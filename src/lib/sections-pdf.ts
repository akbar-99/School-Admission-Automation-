import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { STATUS_LABEL } from "@/lib/types";
import type { SectionReportRow } from "@/lib/sections-report";

// Brand palette (matches admissions-pdf.ts / the web theme).
const TEAL = rgb(0x1b / 255, 0x7e / 255, 0x9a / 255);
const INK = rgb(0x14 / 255, 0x32 / 255, 0x3b / 255);
const GREY = rgb(0x5c / 255, 0x72 / 255, 0x7a / 255);
const LINE = rgb(0xe0 / 255, 0xe9 / 255, 0xea / 255);
const SOFT = rgb(0xee / 255, 0xf3 / 255, 0xf3 / 255);

export interface SectionsReportPdfInput {
  schoolName: string;
  schoolPhone: string;
  schoolEmail: string;
  logo: Uint8Array | null;
  generatedAt: string; // already formatted
  rows: SectionReportRow[]; // one row per section, each carrying its own students
}

const STUDENT_COLS: { key: "student" | "parent" | "phone" | "admNo" | "status"; label: string; w: number }[] = [
  { key: "student", label: "STUDENT", w: 160 },
  { key: "parent", label: "PARENT", w: 150 },
  { key: "phone", label: "PHONE", w: 100 },
  { key: "admNo", label: "ADM. NO.", w: 100 },
  { key: "status", label: "STATUS", w: 130 },
];

// Landscape A4, grouped Grade → Section → students — reads as a printable
// class roster, not a flat spreadsheet-style table (that's what the Excel
// export is for).
export async function generateSectionsReportPdf(input: SectionsReportPdfInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle("Class Sections Report");
  doc.setAuthor(input.schoolName);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  const W = 841.89; // landscape A4
  const H = 595.28;
  const M = 40;
  const right = W - M;

  let page = doc.addPage([W, H]);
  let y = H - M;

  const text = (s: string, x: number, yy: number, size: number, f: PDFFont = font, color = INK) =>
    page.drawText(s ?? "", { x, y: yy, size, font: f, color });

  const newPage = () => {
    page = doc.addPage([W, H]);
    y = H - M;
  };

  const ensureSpace = (needed: number) => {
    if (y - needed < 50) newPage();
  };

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
  text(input.schoolName, M + 100, y - 18, 16, bold, TEAL);
  text(`${input.schoolPhone}  ·  ${input.schoolEmail}`, M + 100, y - 34, 9, font, GREY);

  const title = "CLASS SECTIONS REPORT";
  text(title, right - bold.widthOfTextAtSize(title, 14), y - 16, 14, bold, INK);
  const genLine = `Generated: ${input.generatedAt}`;
  text(genLine, right - font.widthOfTextAtSize(genLine, 9), y - 30, 9, font, GREY);
  y -= 56;

  page.drawLine({ start: { x: M, y }, end: { x: right, y }, thickness: 1.5, color: TEAL });
  y -= 20;

  let currentGrade: string | null = null;

  for (const section of input.rows) {
    if (section.grade !== currentGrade) {
      currentGrade = section.grade;
      ensureSpace(34);
      text(currentGrade, M, y, 13, bold, TEAL);
      y -= 20;
    }

    ensureSpace(40);
    const seatLine = `${section.filled} / ${section.capacity} seats`;
    const headerBits = [
      `Section ${section.name}`,
      section.batch,
      section.classTiming,
      seatLine,
      section.broadwayClassName,
    ].filter(Boolean) as string[];
    text(headerBits.join("   ·   "), M + 10, y, 10.5, bold, INK);
    y -= 16;

    if (section.students.length === 0) {
      text("No students enrolled yet.", M + 10, y, 9, italic, GREY);
      y -= 18;
      continue;
    }

    // ---- Mini table header for this section's students ----
    ensureSpace(20);
    let colX = M + 10;
    for (const c of STUDENT_COLS) {
      text(c.label, colX, y, 8, bold, GREY);
      colX += c.w;
    }
    y -= 4;
    page.drawLine({ start: { x: M + 10, y }, end: { x: right, y }, thickness: 0.75, color: LINE });
    y -= 14;

    let zebra = false;
    for (const st of section.students) {
      ensureSpace(18);
      if (zebra) {
        page.drawRectangle({ x: M + 10, y: y - 10, width: right - (M + 10), height: 17, color: SOFT });
      }
      zebra = !zebra;
      const cells = {
        student: st.studentName,
        parent: st.parentName,
        phone: st.parentPhone ?? "—",
        admNo: st.admissionNumber ?? "—",
        status: STATUS_LABEL[st.status] ?? st.status,
      };
      colX = M + 10;
      for (const c of STUDENT_COLS) {
        let v = cells[c.key];
        while (font.widthOfTextAtSize(v, 9) > c.w - 10 && v.length > 1) {
          v = v.slice(0, -2) + "…";
        }
        text(v, colX, y, 9, font, INK);
        colX += c.w;
      }
      y -= 17;
    }
    y -= 10;
  }

  // ---- Footer on every page ----
  for (const p of doc.getPages()) {
    const foot = `${input.schoolName} · Confidential — class sections report, computer-generated.`;
    p.drawText(foot, { x: M, y: 24, size: 7.5, font, color: GREY });
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
