"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

// Both panels are already fully server-fetched and passed in as children —
// switching tabs is instant, no re-fetch, no loading state needed.
export function DashboardTabs({
  panels,
}: {
  panels: { label: string; content: React.ReactNode }[];
}) {
  const [active, setActive] = useState(0);

  return (
    <div className="space-y-6">
      <div className="inline-flex gap-1 rounded-full border border-border bg-muted/40 p-1">
        {panels.map((p, i) => (
          <button
            key={p.label}
            type="button"
            onClick={() => setActive(i)}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              i === active
                ? "bg-card text-foreground shadow-soft"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {panels[active].content}
    </div>
  );
}
