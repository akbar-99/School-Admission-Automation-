import { Badge } from "@/components/ui/badge";
import { TEMPERATURE_LABEL, type Temperature } from "@/lib/lead-scoring";

const TONE: Record<Temperature, "danger" | "warning" | "info"> = {
  HOT: "danger",
  WARM: "warning",
  COLD: "info",
};

// Shared everywhere a lead's name is shown in a list — admin's applications
// table, the marketing leads table, a team member's own leads, the Team
// dashboard drill-down modal. A manual override always wins over the
// computed temperature; an unscored lead renders nothing (not an empty
// badge) so a long-unscored list doesn't look broken.
export function LeadTemperatureBadge({
  temperature,
  override,
  className,
}: {
  temperature: Temperature | null;
  override?: Temperature | null;
  className?: string;
}) {
  const effective = override ?? temperature;
  if (!effective) return null;
  return (
    <Badge tone={TONE[effective]} className={className}>
      {TEMPERATURE_LABEL[effective]}
    </Badge>
  );
}
