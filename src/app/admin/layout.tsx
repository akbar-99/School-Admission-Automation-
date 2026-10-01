import { requireRole } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireRole(["admin", "coo"]);
  return (
    <DashboardShell
      roleLabel={profile.role === "coo" ? "COO" : "Admin"}
      userName={profile.full_name ?? profile.email ?? "Admin"}
      homeHref="/admin"
      nav={[
        { href: "/admin", label: "Overview" },
        ...(profile.role === "coo" ? [{ href: "/admin/coo-dashboard", label: "Team dashboard" }] : []),
        { href: "/marketing", label: "Leads" },
        { href: "/admin/payments", label: "Payments" },
        { href: "/admin/assessments", label: "Assessments" },
        { href: "/admin/sections", label: "Sections" },
        { href: "/admin/staff", label: "Staff" },
        { href: "/admin/erp", label: "ERP" },
        { href: "/admin/notifications", label: "Notifications" },
        { href: "/admin/settings", label: "Settings" },
      ]}
    >
      {children}
    </DashboardShell>
  );
}
