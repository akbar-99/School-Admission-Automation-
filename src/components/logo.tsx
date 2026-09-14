import Image from "next/image";
import { cn } from "@/lib/utils";

// Broadway Home Schooling — official brand assets (processed to transparent PNG).
const MARK_RATIO = 188 / 193; // w / h
const FULL_RATIO = 515 / 332; // w / h
// Cropped directly from the official lockup (broadway-logo.png, rows 203-300)
// — the real "Broadway" lettering, not a font approximation.
const WORDMARK_RATIO = 515 / 97; // w / h

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

// Wordmark only ("Broadway" lettering), for horizontal lockups where the
// tagline is set separately as small crisp text below it.
export function LogoWordmark({
  height = 26,
  className,
  priority,
}: {
  height?: number;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/broadway-wordmark.png"
      alt="Broadway"
      width={Math.round(height * WORDMARK_RATIO)}
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

// Compact vertical lockup for headers: icon on top, wordmark + tagline
// stacked below — the same shape as the real logo (LogoFull), just built
// from the separate real-asset pieces so the tagline stays crisp text
// instead of shrinking into an illegible raster at small sizes.
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
  const markH = { sm: 30, md: 40, lg: 54 }[size];
  const wordH = { sm: 18, md: 24, lg: 32 }[size];
  const sub = { sm: "text-[8px]", md: "text-[9px]", lg: "text-[11px]" }[size];

  return (
    <span className={cn("inline-flex flex-col items-center gap-1", className)}>
      <LogoMark height={markH} priority />
      {showWordmark && (
        <span className="flex flex-col items-center gap-0.5 leading-none">
          <LogoWordmark height={wordH} priority />
          {subtitle && (
            <span
              className={cn(
                "whitespace-nowrap font-sans uppercase tracking-[0.15em] text-muted-foreground",
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
