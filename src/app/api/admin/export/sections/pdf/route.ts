import { requireRole } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { fetchSchoolLogo } from "@/lib/school-logo";
import { fetchSectionsReportRows } from "@/lib/sections-report";
import { generateSectionsReportPdf } from "@/lib/sections-pdf";

export const dynamic = "force-dynamic";

// Admin-only: PDF export of every class section — grouped Grade → Section,
// each with its enrolled students. Same source data as /admin/sections.
export async function GET() {
  await requireRole(["admin", "coo"]);

  const [rows, settings, logo] = await Promise.all([
    fetchSectionsReportRows(),
    getSettings(),
    fetchSchoolLogo(),
  ]);

  const pdf = await generateSectionsReportPdf({
    schoolName: settings.schoolName,
    schoolPhone: settings.schoolPhone,
    schoolEmail: settings.schoolEmail,
    logo,
    generatedAt: new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
    rows,
  });

  const filename = `class-sections-${new Date().toISOString().slice(0, 10)}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
