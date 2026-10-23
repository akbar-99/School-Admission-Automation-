import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { STATUS_LABEL } from "@/lib/types";
import type { SectionReportRow } from "@/lib/sections-report";

// Brand palette (matches admissions-pdf.ts / the web theme).
const TEAL = rgb(0x1b / 255, 0x7e / 255, 0x9a / 255);
const TEAL_SOFT = rgb(0xe3 / 255, 0xf0 / 255, 0xf3 / 255);
const INK = rgb(0x14 / 255, 0x32 / 255, 0x3b / 255);
const GREY = rgb(0x5c / 255, 0x72 / 255, 0x7a / 255);
const LINE = rgb(0xd8 / 255, 0xe2 / 255, 0xe3 / 255);
const SOFT = rgb(0xf4 / 255, 0xf7 / 255, 0xf7 / 255);
const WHITE = rgb(1, 1, 1);
const GREEN = rgb(0x1d / 255, 0x7a / 255, 0x4a / 255);
const GREEN_SOFT = rgb(0xe4 / 255, 0xf3 / 255, 0xea / 255);
const AMBER = rgb(0xa1 / 255, 0x62 / 255, 0x0a / 255);
const AMBER_SOFT = rgb(0xfb / 255, 0xf0 / 255, 0xdc / 255);

export interface SectionsReportPdfInput {
  schoolName: string;
  schoolPhone: string;
  schoolEmail: string;
  logo: Uint8Array | null;
  generatedAt: string; // already formatted
  rows: SectionReportRow[]; // one row per section, each carrying its own students
}

const STUDENT_COLS: { key: "student" | "parent" | "phone" | "admNo" | "status"; label: string; w: number }[] = [
  { key: "student", label: "STUDENT", w: 185 },
  { key: "parent", label: "PARENT", w: 165 },
  { key: "phone", label: "PHONE", w: 110 },
  { key: "admNo", label: "ADM. NO.", w: 105 },
  { key: "status", label: "STATUS", w: 130 },
];

const ROW_H = 18;
const TABLE_HEADER_H = 20;
const CARD_PAD = 10;

// Landscape A4, grouped Grade → Section — each section renders as its own
// bordered card (title + seat badge + a mini roster table), reading as a
// printable class list rather than a dense wall of text.
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
  const contentW = right - M;

  let page = doc.addPage([W, H]);
  let y = H - M;

  const text = (s: string, x: number, yy: number, size: number, f: PDFFont = font, color = INK) =>
    page.drawText(s ?? "", { x, y: yy, size, font: f, color });

  const centeredText = (s: string, cx: number, yy: number, size: number, f: PDFFont, color = INK) =>
    text(s, cx - f.widthOfTextAtSize(s, size) / 2, yy, size, f, color);

  const newPage = () => {
    page = doc.addPage([W, H]);
    y = H - M;
  };

  // Height a section's full card will take, so a card is never split with
  // its title on one page and its table on the next.
  const cardHeight = (section: SectionReportRow): number => {
    const titleH = 34;
    if (section.students.length === 0) return titleH + 26;
    return titleH + TABLE_HEADER_H + section.students.length * ROW_H + 16;
  };

  const ensureSpace = (needed: number, regrade?: string) => {
    if (y - needed < 56) {
      newPage();
      if (regrade) drawGradeBand(regrade);
    }
  };

  const drawGradeBand = (grade: string) => {
    page.drawRectangle({ x: M, y: y - 24, width: contentW, height: 24, color: TEAL });
    text(grade.toUpperCase(), M + 10, y - 17, 11.5, bold, WHITE);
    y -= 32;
  };

  // ---- Page header: logo + school + contact ----
  const embeddedLogo = input.logo
    ? await (async () => {
        try {
          return await doc.embedPng(input.logo!);
        } catch {
          return null;
        }
      })()
    : null;
  if (embeddedLogo) {
    const h = 40;
    const w = (embeddedLogo.width / embeddedLogo.height) * h;
    page.drawImage(embeddedLogo, { x: M, y: y - h, width: w, height: h });
  }
  text(input.schoolName, M + 100, y - 18, 16, bold, TEAL);
  text(`${input.schoolPhone}  ·  ${input.schoolEmail}`, M + 100, y - 34, 9, font, GREY);

  const title = "CLASS SECTIONS REPORT";
  text(title, right - bold.widthOfTextAtSize(title, 14), y - 16, 14, bold, INK);
  const genLine = `Generated: ${input.generatedAt}`;
  text(genLine, right - font.widthOfTextAtSize(genLine, 9), y - 30, 9, font, GREY);
  y -= 56;

  page.drawLine({ start: { x: M, y }, end: { x: right, y }, thickness: 1.5, color: TEAL });
  y -= 24;

  let currentGrade: string | null = null;

  for (const section of input.rows) {
    if (section.grade !== currentGrade) {
      currentGrade = section.grade;
      ensureSpace(24 + 34);
      drawGradeBand(currentGrade);
    }

    const h = cardHeight(section);
    ensureSpace(h, currentGrade);

    const cardTop = y;
    const cardBottom = y - h;
    page.drawRectangle({
      x: M,
      y: cardBottom,
      width: contentW,
      height: h,
      color: WHITE,
      borderColor: LINE,
      borderWidth: 1,
    });

    // ---- Title row: section name · batch · timing, seat badge on the right ----
    const titleY = cardTop - 20;
    const nameLine = `Section ${section.name}`;
    text(nameLine, M + CARD_PAD, titleY, 11.5, bold, INK);
    let subX = M + CARD_PAD + bold.widthOfTextAtSize(nameLine, 11.5) + 10;
    const subBits = [section.batch, section.classTiming].filter(Boolean) as string[];
    if (subBits.length) {
      const subLine = subBits.join("  ·  ");
      text(subLine, subX, titleY, 9.5, font, GREY);
      subX += font.widthOfTextAtSize(subLine, 9.5);
    }

    const full = section.filled >= section.capacity;
    const empty = section.filled === 0;
    const [badgeFill, badgeText] = full ? [AMBER_SOFT, AMBER] : empty ? [SOFT, GREY] : [GREEN_SOFT, GREEN];
    const seatLabel = `${section.filled} / ${section.capacity} seats${full ? " · FULL" : ""}`;
    const badgeW = bold.widthOfTextAtSize(seatLabel, 9) + 20;
    const badgeX = right - CARD_PAD - badgeW;
    page.drawRectangle({ x: badgeX, y: titleY - 5, width: badgeW, height: 18, color: badgeFill });
    centeredText(seatLabel, badgeX + badgeW / 2, titleY - 1, 9, bold, badgeText);

    if (section.broadwayClassName) {
      const bwLine = `Broadway: ${section.broadwayClassName}`;
      text(
        bwLine,
        badgeX - 10 - font.widthOfTextAtSize(bwLine, 8.5),
        titleY - 1,
        8.5,
        italic,
        GREY,
      );
    }

    y = titleY - 14;
    page.drawLine({ start: { x: M, y }, end: { x: right, y }, thickness: 0.75, color: LINE });
    y -= 1;

    if (section.students.length === 0) {
      text("No students enrolled yet.", M + CARD_PAD, y - 17, 9, italic, GREY);
      y = cardBottom - 10;
      continue;
    }

    // ---- Mini roster table (teal header band, matches the admissions report style) ----
    page.drawRectangle({ x: M, y: y - TABLE_HEADER_H, width: contentW, height: TABLE_HEADER_H, color: TEAL_SOFT });
    let colX = M + CARD_PAD;
    for (const c of STUDENT_COLS) {
      text(c.label, colX, y - 14, 8, bold, TEAL);
      colX += c.w;
    }
    y -= TABLE_HEADER_H;

    let zebra = false;
    for (const st of section.students) {
      if (zebra) {
        page.drawRectangle({ x: M, y: y - ROW_H, width: contentW, height: ROW_H, color: SOFT });
      }
      zebra = !zebra;
      const cells = {
        student: st.studentName,
        parent: st.parentName,
        phone: st.parentPhone ?? "—",
        admNo: st.admissionNumber ?? "—",
        status: STATUS_LABEL[st.status] ?? st.status,
      };
      colX = M + CARD_PAD;
      const rowTextY = y - 13;
      for (const c of STUDENT_COLS) {
        let v = cells[c.key];
        while (font.widthOfTextAtSize(v, 9) > c.w - 12 && v.length > 1) {
          v = v.slice(0, -2) + "…";
        }
        text(v, colX, rowTextY, 9, font, INK);
        colX += c.w;
      }
      y -= ROW_H;
      page.drawLine({ start: { x: M, y }, end: { x: right, y }, thickness: 0.5, color: LINE });
    }
    y = cardBottom - 10;
  }

  // ---- Footer on every page ----
  for (const p of doc.getPages()) {
    const foot = `${input.schoolName} · Confidential — class sections report, computer-generated.`;
    p.drawText(foot, { x: M, y: 24, size: 7.5, font, color: GREY });
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
