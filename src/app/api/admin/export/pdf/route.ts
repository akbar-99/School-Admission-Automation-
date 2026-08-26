import { requireRole } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { fetchSchoolLogo } from "@/lib/school-logo";
import {
  describeFilters,
  fetchAdmissionsReportRows,
  parseAdmissionsFilters,
} from "@/lib/admissions-report";
import { generateAdmissionsReportPdf } from "@/lib/admissions-pdf";

export const dynamic = "force-dynamic";

// Admin-only: PDF export of the (filtered) admissions list — same filters as
// the Applications table on /admin, passed through as query params.
export async function GET(request: Request) {
  await requireRole(["admin"]);

  const url = new URL(request.url);
  const filters = parseAdmissionsFilters({
    status: url.searchParams.get("status") ?? undefined,
    category: url.searchParams.get("category") ?? undefined,
    grade: url.searchParams.get("grade") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });

  const [rows, settings, logo] = await Promise.all([
    fetchAdmissionsReportRows(filters, 5000),
    getSettings(),
    fetchSchoolLogo(),
  ]);

  const pdf = await generateAdmissionsReportPdf({
    schoolName: settings.schoolName,
    schoolPhone: settings.schoolPhone,
    schoolEmail: settings.schoolEmail,
    logo,
    generatedAt: new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
    filterSummary: describeFilters(filters),
    rows,
  });

  const filename = `admissions-report-${new Date().toISOString().slice(0, 10)}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
