import { requireRole } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireRole(["marketing", "admin"]);
  return (
    <DashboardShell
      roleLabel="Marketing"
      userName={profile.full_name ?? profile.email ?? "Marketing"}
      nav={[
        { href: "/marketing", label: "Leads" },
        { href: "/marketing/performance", label: "Your performance" },
        { href: "/marketing/seats", label: "Seat availability" },
      ]}
    >
      {children}
    </DashboardShell>
  );
}
