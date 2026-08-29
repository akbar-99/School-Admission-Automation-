import { requireRole } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireRole(["teacher", "admin"]);
  return (
    <DashboardShell
      roleLabel="Assessment Teacher"
      userName={profile.full_name ?? profile.email ?? "Teacher"}
      nav={[
        { href: "/teacher", label: "Assessments" },
        { href: "/teacher/history", label: "Assessment history" },
      ]}
    >
      {children}
    </DashboardShell>
  );
}
