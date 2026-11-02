"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// Generic "Show/Hide N things" toggle, collapsed by default — used wherever
// a table could run to dozens of rows and the admin usually only wants the
// summary above it, not the full list, on first load.
export function CollapsibleSection({
  count,
  itemLabel,
  itemLabelPlural,
  defaultOpen = false,
  children,
}: {
  count: number;
  itemLabel: string;
  itemLabelPlural?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const label = count === 1 ? itemLabel : (itemLabelPlural ?? `${itemLabel}s`);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
        {open ? "Hide" : "Show"} {count} {label}
      </button>

      {open && <div className="mt-3 overflow-x-auto">{children}</div>}
    </div>
  );
}
