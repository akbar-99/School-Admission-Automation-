import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// Brand palette (matches the web theme).
const TEAL = rgb(0x1b / 255, 0x7e / 255, 0x9a / 255);
const INK = rgb(0x14 / 255, 0x32 / 255, 0x3b / 255);
const GREY = rgb(0x5c / 255, 0x72 / 255, 0x7a / 255);
const GREEN = rgb(0x2f / 255, 0x8f / 255, 0x6b / 255);
const RED = rgb(0xc0 / 255, 0x39 / 255, 0x2b / 255);
const LINE = rgb(0xe0 / 255, 0xe9 / 255, 0xea / 255);
const SOFT = rgb(0xee / 255, 0xf3 / 255, 0xf3 / 255);

export interface ResultPdfInput {
  schoolName: string;
  schoolPhone: string;
  schoolEmail: string;
  studentName: string;
  dob: string | null; // already formatted
  grade: string | null;
  parentName: string;
  admissionRef: string;
  outcome: string; // PASS | FAIL
  remarks: string | null;
  subjects: { subject: string; score: number | null; comment: string | null }[];
  logo: Uint8Array | null;
  date: string; // already formatted
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = (text ?? "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export async function generateResultPdf(input: ResultPdfInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle("Assessment Result");
  doc.setAuthor(input.schoolName);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const W = 595.28;
  const H = 841.89;
  const M = 50;
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
      const h = 56;
      const w = (png.width / png.height) * h;
      page.drawImage(png, { x: (W - w) / 2, y: y - h, width: w, height: h });
      y -= h + 8;
    } catch {
      // ignore bad image; fall back to text
    }
  }
  if (!input.logo) {
    const size = 20;
    const w = bold.widthOfTextAtSize(input.schoolName, size);
    text(page, input.schoolName, (W - w) / 2, y - size, size, bold, TEAL);
    y -= size + 8;
  }
  const contact = `${input.schoolPhone}  ·  ${input.schoolEmail}`;
  const cw = font.widthOfTextAtSize(contact, 9);
  text(page, contact, (W - cw) / 2, y - 9, 9, font, GREY);
  y -= 22;

  page.drawLine({ start: { x: M, y }, end: { x: right, y }, thickness: 1.5, color: TEAL });
  y -= 26;

  // ---- Title ----
  text(page, "ASSESSMENT RESULT", M, y - 16, 16, bold, INK);
  const dlabel = `Date: ${input.date}`;
  text(page, dlabel, right - font.widthOfTextAtSize(dlabel, 9), y - 12, 9, font, GREY);
  y -= 30;

  // ---- Details (two columns) ----
  const rows: [string, string][] = [
    ["Student name", input.studentName || "—"],
    ["Date of birth", input.dob || "—"],
    ["Class / grade", input.grade || "—"],
    ["Parent / guardian", input.parentName || "—"],
  ];
  const colW = (right - M) / 2;
  for (let i = 0; i < rows.length; i += 2) {
    const rowY = y;
    for (let c = 0; c < 2 && i + c < rows.length; c++) {
      const [k, v] = rows[i + c];
      const x = M + c * colW;
      text(page, k.toUpperCase(), x, rowY - 9, 8, bold, GREY);
      text(page, v, x, rowY - 24, 11, font, INK);
    }
    y -= 38;
  }
  text(page, `Reference: ${input.admissionRef}`, M, y - 8, 8, font, GREY);
  y -= 24;

  // ---- Subject table ----
  const cSub = M;
  const cScore = M + 170;
  const cRem = M + 250;
  const remW = right - cRem;

  const headerRow = (yy: number) => {
    page.drawRectangle({ x: M, y: yy - 20, width: right - M, height: 20, color: TEAL });
    text(page, "SUBJECT", cSub + 8, yy - 14, 9, bold, rgb(1, 1, 1));
    text(page, "SCORE", cScore, yy - 14, 9, bold, rgb(1, 1, 1));
    text(page, "REMARKS", cRem, yy - 14, 9, bold, rgb(1, 1, 1));
    return yy - 20;
  };
  y = headerRow(y);

  let zebra = false;
  for (const s of input.subjects) {
    const commentLines = wrap(s.comment ?? "", font, 9.5, remW - 8);
    const rowH = Math.max(24, 10 + commentLines.length * 12);
    if (y - rowH < 110) {
      page = doc.addPage([W, H]);
      y = H - M;
      y = headerRow(y);
      zebra = false;
    }
    if (zebra) {
      page.drawRectangle({ x: M, y: y - rowH, width: right - M, height: rowH, color: SOFT });
    }
    zebra = !zebra;
    const baseY = y - 16;
    text(page, s.subject, cSub + 8, baseY, 10.5, bold, INK);
    text(page, s.score != null ? `${s.score}/100` : "—", cScore, baseY, 10.5, font, INK);
    commentLines.forEach((ln, idx) => text(page, ln, cRem, baseY - idx * 12, 9.5, font, GREY));
    y -= rowH;
    page.drawLine({ start: { x: M, y }, end: { x: right, y }, thickness: 0.5, color: LINE });
  }
  y -= 28;

  // ---- Overall result pill ----
  const pass = input.outcome.toUpperCase() === "PASS";
  const pillColor = pass ? GREEN : RED;
  const pillText = `RESULT:  ${input.outcome.toUpperCase()}`;
  const pillW = bold.widthOfTextAtSize(pillText, 12) + 28;
  page.drawRectangle({ x: M, y: y - 26, width: pillW, height: 26, color: pillColor });
  text(page, pillText, M + 14, y - 18, 12, bold, rgb(1, 1, 1));
  y -= 44;

  // ---- Remarks ----
  if (input.remarks) {
    text(page, "REMARKS", M, y - 9, 8, bold, GREY);
    y -= 18;
    for (const ln of wrap(input.remarks, font, 10.5, right - M)) {
      text(page, ln, M, y - 11, 10.5, font, INK);
      y -= 15;
    }
    y -= 10;
  }

  // ---- Footer ----
  const footY = 46;
  page.drawLine({ start: { x: M, y: footY + 16 }, end: { x: right, y: footY + 16 }, thickness: 0.5, color: LINE });
  const foot = `${input.schoolName} · This is a computer-generated assessment report.`;
  text(page, foot, M, footY, 8, font, GREY);

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
