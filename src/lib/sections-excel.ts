import "server-only";
import ExcelJS from "exceljs";
import { STATUS_LABEL } from "@/lib/types";
import type { SectionReportRow } from "@/lib/sections-report";

const TEAL = "FF1B7E9A";
const INK = "FF14323B";
const GREY = "FF5C727A";
const SOFT = "FFEEF3F3";
const WHITE = "FFFFFFFF";

export interface SectionsReportExcelInput {
  schoolName: string;
  schoolPhone: string;
  schoolEmail: string;
  logo: Uint8Array | null;
  generatedAt: string; // already formatted
  rows: SectionReportRow[];
}

const COLUMNS: { key: string; header: string; width: number }[] = [
  { key: "grade", header: "Grade", width: 12 },
  { key: "section", header: "Section", width: 10 },
  { key: "batch", header: "Batch", width: 14 },
  { key: "timing", header: "Class timing", width: 20 },
  { key: "seats", header: "Seats (filled/capacity)", width: 20 },
  { key: "student", header: "Student", width: 24 },
  { key: "parent", header: "Parent", width: 22 },
  { key: "phone", header: "Phone", width: 16 },
  { key: "admission_no", header: "Admission No.", width: 16 },
  { key: "status", header: "Status", width: 20 },
];

// One row per enrolled student — flat and filterable, unlike the PDF's
// grouped roster layout. A section with no students still gets exactly one
// row (student fields blank) so its seat count/timing shows up in the
// export even before anyone's enrolled.
export async function generateSectionsReportExcel(input: SectionsReportExcelInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = input.schoolName;
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Class Sections", {
    views: [{ state: "frozen", ySplit: 7 }],
  });
  sheet.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }));

  if (input.logo) {
    try {
      const imageId = workbook.addImage({ buffer: input.logo as unknown as ExcelJS.Buffer, extension: "png" });
      sheet.addImage(imageId, {
        tl: { col: 0.15, row: 0.15 },
        ext: { width: 120, height: 78 },
      });
    } catch {
      // logo is optional
    }
  }

  const lastCol = String.fromCharCode(64 + COLUMNS.length); // "J"
  sheet.mergeCells(`B1:${lastCol}1`);
  sheet.getCell("B1").value = input.schoolName;
  sheet.getCell("B1").font = { size: 16, bold: true, color: { argb: TEAL } };

  sheet.mergeCells(`B2:${lastCol}2`);
  sheet.getCell("B2").value = `${input.schoolPhone}  ·  ${input.schoolEmail}`;
  sheet.getCell("B2").font = { size: 10, color: { argb: GREY } };

  sheet.mergeCells(`B3:${lastCol}3`);
  sheet.getCell("B3").value = "CLASS SECTIONS REPORT";
  sheet.getCell("B3").font = { size: 12, bold: true, color: { argb: INK } };

  const totalStudents = input.rows.reduce((n, r) => n + r.students.length, 0);
  sheet.mergeCells(`A5:${lastCol}5`);
  sheet.getCell("A5").value =
    `Generated: ${input.generatedAt}   ·   ${input.rows.length} section${input.rows.length === 1 ? "" : "s"}   ·   ${totalStudents} student${totalStudents === 1 ? "" : "s"}`;
  sheet.getCell("A5").font = { size: 10, italic: true, color: { argb: GREY } };

  // ---- Header row ----
  const headerRow = sheet.getRow(7);
  COLUMNS.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
    cell.alignment = { vertical: "middle" };
    cell.border = { bottom: { style: "thin", color: { argb: TEAL } } };
  });
  headerRow.height = 20;
  headerRow.commit();
  sheet.autoFilter = { from: { row: 7, column: 1 }, to: { row: 7, column: COLUMNS.length } };

  // ---- Data rows ----
  let i = 0;
  for (const section of input.rows) {
    const base = {
      grade: section.grade,
      section: section.name,
      batch: section.batch ?? "—",
      timing: section.classTiming ?? "—",
      seats: `${section.filled}/${section.capacity}`,
    };
    const studentRows = section.students.length
      ? section.students.map((st) => ({
          ...base,
          student: st.studentName,
          parent: st.parentName,
          phone: st.parentPhone ?? "—",
          admission_no: st.admissionNumber ?? "—",
          status: STATUS_LABEL[st.status] ?? st.status,
        }))
      : [{ ...base, student: "—", parent: "—", phone: "—", admission_no: "—", status: "—" }];

    for (const r of studentRows) {
      const row = sheet.addRow(r);
      const zebra = i % 2 === 1;
      row.eachCell((cell) => {
        cell.font = { color: { argb: INK }, size: 10.5 };
        cell.border = { bottom: { style: "thin", color: { argb: "FFE0E9EA" } } };
        if (zebra) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } };
        }
      });
      i += 1;
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
