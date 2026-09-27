import { Badge } from "@/components/ui/badge";
import { WITHDRAWAL_TYPE_LABEL, type WithdrawalType } from "@/lib/types";

export function WithdrawalBadge({
  type,
  reason,
}: {
  type: WithdrawalType;
  reason: string | null;
}) {
  return (
    <Badge tone="danger" title={reason ?? undefined}>
      {WITHDRAWAL_TYPE_LABEL[type]}
    </Badge>
  );
}
