import { requireRole } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { fetchSchoolLogo } from "@/lib/school-logo";
import { fetchSectionsReportRows } from "@/lib/sections-report";
import { generateSectionsReportExcel } from "@/lib/sections-excel";

export const dynamic = "force-dynamic";

// Admin-only: Excel export of every class section — one row per enrolled
// student (flat/filterable), plus a placeholder row for an empty section.
// Same source data as /admin/sections.
export async function GET() {
  await requireRole(["admin", "coo"]);

  const [rows, settings, logo] = await Promise.all([
    fetchSectionsReportRows(),
    getSettings(),
    fetchSchoolLogo(),
  ]);

  const excel = await generateSectionsReportExcel({
    schoolName: settings.schoolName,
    schoolPhone: settings.schoolPhone,
    schoolEmail: settings.schoolEmail,
    logo,
    generatedAt: new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
    rows,
  });

  const filename = `class-sections-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new Response(new Uint8Array(excel), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
