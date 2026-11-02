import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CollapsibleSection } from "@/components/admin/collapsible-section";

export interface SlotCreationLogRow {
  id: number;
  createdLabel: string;
  createdByName: string;
  dayTimeLabel: string;
  totalLabel: string;
  weeksNote: string | null;
  assignedToName: string | null; // null = open pool
}

// Collapsed by default — a month of "Create slots" batches can run to
// dozens of rows, and the admin usually only wants the total up top.
export function SlotCreationLogTable({ rows }: { rows: SlotCreationLogRow[] }) {
  return (
    <CollapsibleSection count={rows.length} itemLabel="batch" itemLabelPlural="batches">
      <Table>
        <THead>
          <TR>
            <TH>Created</TH>
            <TH>Created by</TH>
            <TH>Day &amp; time</TH>
            <TH>Quantity</TH>
            <TH>Assigned to</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id}>
              <TD className="whitespace-nowrap">{r.createdLabel}</TD>
              <TD>{r.createdByName}</TD>
              <TD>{r.dayTimeLabel}</TD>
              <TD>
                {r.totalLabel}
                {r.weeksNote && <span className="text-xs text-muted-foreground"> {r.weeksNote}</span>}
              </TD>
              <TD>{r.assignedToName ?? <Badge tone="info">Open pool</Badge>}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </CollapsibleSection>
  );
}
