import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    className={cn(
      // text-base (16px), not text-sm — iOS Safari auto-zooms on focus for
      // any input under 16px and the zoom tends to stick, which is exactly
      // the "app always shows zoomed in on mobile" symptom this fixes.
      "flex h-11 w-full rounded-md border border-input bg-card px-3.5 py-2 text-base shadow-soft transition-colors placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary/40 disabled:cursor-not-allowed disabled:opacity-50 file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
