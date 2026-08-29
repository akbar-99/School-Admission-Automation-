import { requireRole } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireRole(["admin"]);
  return (
    <DashboardShell
      roleLabel="Admin"
      userName={profile.full_name ?? profile.email ?? "Admin"}
      nav={[
        { href: "/admin", label: "Overview" },
        { href: "/admin/marketing-performance", label: "Marketing performance" },
        { href: "/admin/assessments", label: "Assessments" },
        { href: "/admin/sections", label: "Sections" },
        { href: "/admin/staff", label: "Staff" },
        { href: "/admin/notifications", label: "Notifications" },
        { href: "/admin/settings", label: "Settings" },
      ]}
    >
      {children}
    </DashboardShell>
  );
}
