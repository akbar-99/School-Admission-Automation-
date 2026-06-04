import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL, STATUS_TONE, type AppStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: AppStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}
