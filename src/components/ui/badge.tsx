import * as React from "react";
import { cn } from "@/lib/utils";
import type { BadgeTone } from "@/lib/types";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-muted text-muted-foreground ring-border",
  info: "bg-secondary text-secondary-foreground ring-primary/15",
  warning: "bg-amber-50 text-amber-700 ring-amber-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  danger: "bg-red-50 text-red-700 ring-red-200",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
