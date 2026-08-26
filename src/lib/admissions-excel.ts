import "server-only";
import ExcelJS from "exceljs";
import { STATUS_LABEL } from "@/lib/types";
import type { AdmissionsReportRow } from "@/lib/admissions-report";

const TEAL = "FF1B7E9A";
const INK = "FF14323B";
const GREY = "FF5C727A";
const SOFT = "FFEEF3F3";
const WHITE = "FFFFFFFF";

export interface AdmissionsReportExcelInput {
  schoolName: string;
  schoolPhone: string;
  schoolEmail: string;
  logo: Uint8Array | null;
  generatedAt: string; // already formatted
  filterSummary: string;
  rows: AdmissionsReportRow[];
}

const COLUMNS: { key: string; header: string; width: number }[] = [
  { key: "student", header: "Student", width: 24 },
  { key: "parent", header: "Parent", width: 22 },
  { key: "phone", header: "Phone", width: 16 },
  { key: "category", header: "Category", width: 12 },
  { key: "grade", header: "Grade", width: 10 },
  { key: "status", header: "Status", width: 20 },
  { key: "admission_no", header: "Admission No.", width: 16 },
  { key: "section", header: "Section", width: 12 },
  { key: "created", header: "Created", width: 16 },
];

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export async function generateAdmissionsReportExcel(
  input: AdmissionsReportExcelInput,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = input.schoolName;
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Admissions Report", {
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

  const lastCol = String.fromCharCode(64 + COLUMNS.length); // e.g. "I"
  sheet.mergeCells(`B1:${lastCol}1`);
  sheet.getCell("B1").value = input.schoolName;
  sheet.getCell("B1").font = { size: 16, bold: true, color: { argb: TEAL } };

  sheet.mergeCells(`B2:${lastCol}2`);
  sheet.getCell("B2").value = `${input.schoolPhone}  ·  ${input.schoolEmail}`;
  sheet.getCell("B2").font = { size: 10, color: { argb: GREY } };

  sheet.mergeCells(`B3:${lastCol}3`);
  sheet.getCell("B3").value = "ADMISSIONS REPORT";
  sheet.getCell("B3").font = { size: 12, bold: true, color: { argb: INK } };

  sheet.mergeCells(`A5:${lastCol}5`);
  sheet.getCell("A5").value = `Filters: ${input.filterSummary}`;
  sheet.getCell("A5").font = { size: 10, color: { argb: GREY } };

  sheet.mergeCells(`A6:${lastCol}6`);
  sheet.getCell("A6").value =
    `Generated: ${input.generatedAt}   ·   ${input.rows.length} record${input.rows.length === 1 ? "" : "s"}`;
  sheet.getCell("A6").font = { size: 10, italic: true, color: { argb: GREY } };

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
  input.rows.forEach((r, i) => {
    const row = sheet.addRow({
      student: r.studentName,
      parent: r.parentName,
      phone: r.parentPhone,
      category: r.category ?? "—",
      grade: r.gradeApplying ?? "—",
      status: STATUS_LABEL[r.status] ?? r.status,
      admission_no: r.admissionNumber ?? "—",
      section: r.sectionGrade ? `${r.sectionGrade}-${r.sectionName}` : "—",
      created: fmtDate(r.createdAt),
    });
    const zebra = i % 2 === 1;
    row.eachCell((cell) => {
      cell.font = { color: { argb: INK }, size: 10.5 };
      cell.border = { bottom: { style: "thin", color: { argb: "FFE0E9EA" } } };
      if (zebra) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } };
      }
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
