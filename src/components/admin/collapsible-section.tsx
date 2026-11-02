"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type LabelProps =
  | { count: number; itemLabel: string; itemLabelPlural?: string; label?: never }
  | { label: string; count?: never; itemLabel?: never; itemLabelPlural?: never };

// Generic "Show/Hide …" toggle, collapsed by default — used wherever a
// section could run long and the admin usually only wants the summary
// around it on first load. Either "Show 13 teachers" (count + itemLabel)
// or "Show calculator" (label).
export function CollapsibleSection({
  defaultOpen = false,
  storageKey,
  children,
  ...labelProps
}: LabelProps & {
  defaultOpen?: boolean;
  // Remembers open/closed for this browser tab — e.g. so a section the
  // admin is working in doesn't snap shut after a form post reloads the page.
  storageKey?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // Read after hydration so the first render matches the server's default.
  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = window.sessionStorage.getItem(storageKey);
      if (saved === "open") setOpen(true);
      else if (saved === "closed") setOpen(false);
    } catch {
      // Storage blocked — fall back to the default.
    }
  }, [storageKey]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (!storageKey) return;
    try {
      window.sessionStorage.setItem(storageKey, next ? "open" : "closed");
    } catch {
      // Storage blocked — the section just won't remember its state.
    }
  }

  const text =
    labelProps.label !== undefined
      ? labelProps.label
      : `${labelProps.count} ${
          labelProps.count === 1 ? labelProps.itemLabel : (labelProps.itemLabelPlural ?? `${labelProps.itemLabel}s`)
        }`;

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
        {open ? "Hide" : "Show"} {text}
      </button>

      {open && <div className="mt-3 overflow-x-auto">{children}</div>}
    </div>
  );
}
