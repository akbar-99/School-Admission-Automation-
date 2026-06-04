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
        { href: "/admin/sections", label: "Sections" },
        { href: "/admin/notifications", label: "Notifications" },
      ]}
    >
      {children}
    </DashboardShell>
  );
}
