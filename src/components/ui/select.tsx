import * as React from "react";
import { cn } from "@/lib/utils";

// Native select styled to match inputs (no Radix dependency).
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      // text-base (16px) — see input.tsx: under 16px, iOS Safari auto-zooms
      // on focus and the zoom tends to stick.
      "flex h-11 w-full rounded-md border border-input bg-card px-3.5 py-2 text-base shadow-soft transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary/40 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";
