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
        // Deliberately no "Leads" link to /marketing's new-lead form here —
        // createLead attributes the lead to whoever is logged in, so an
        // admin using it on a marketing person's behalf files it under the
        // admin's own account instead, throwing off that person's stats
        // (confirmed happening live; fixed via reassignLeadOwner, but best
        // not left easy to repeat). Admins still see every lead on this
        // Overview page and the Team dashboard — just can't create one here.
        { href: "/admin/payments", label: "Payments" },
        { href: "/admin/assessments", label: "Assessments" },
        { href: "/admin/sections", label: "Sections" },
        { href: "/admin/staff", label: "Staff" },
        { href: "/admin/broadway", label: "Broadway" },
        { href: "/admin/notifications", label: "Notifications" },
        { href: "/admin/settings", label: "Settings" },
      ]}
    >
      {children}
    </DashboardShell>
  );
}
