import Image from "next/image";
import { cn } from "@/lib/utils";

// Broadway Home Schooling — official brand assets (processed to transparent PNG).
const MARK_RATIO = 188 / 193; // w / h
const FULL_RATIO = 515 / 332; // w / h

// Mark only (house + sage arch).
export function LogoMark({
  height = 36,
  className,
  priority,
}: {
  height?: number;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/broadway-mark.png"
      alt="Broadway Home Schooling"
      width={Math.round(height * MARK_RATIO)}
      height={height}
      priority={priority}
      className={className}
    />
  );
}

// Complete stacked lockup (mark + wordmark) — the exact logo.
export function LogoFull({
  height = 72,
  className,
  priority,
}: {
  height?: number;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/broadway-logo.png"
      alt="Broadway Home Schooling"
      width={Math.round(height * FULL_RATIO)}
      height={height}
      priority={priority}
      className={className}
    />
  );
}

// Horizontal lockup for headers: official mark + wordmark.
export function Logo({
  className,
  showWordmark = true,
  subtitle = true,
  size = "md",
}: {
  className?: string;
  showWordmark?: boolean;
  subtitle?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const markH = { sm: 34, md: 40, lg: 54 }[size];
  const word = { sm: "text-lg", md: "text-2xl", lg: "text-4xl" }[size];
  const sub = { sm: "text-[8.5px]", md: "text-[10px]", lg: "text-sm" }[size];

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark height={markH} priority />
      {showWordmark && (
        <span className="flex flex-col leading-none">
          <span className={cn("font-logo font-semibold tracking-tight text-primary", word)}>
            Broadway
          </span>
          {subtitle && (
            <span
              className={cn(
                "font-sans uppercase tracking-[0.2em] text-muted-foreground",
                sub,
              )}
            >
              Home Schooling
            </span>
          )}
        </span>
      )}
    </span>
  );
}
