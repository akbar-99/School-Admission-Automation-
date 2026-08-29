"use client";

import { useEffect, useState } from "react";
import { Video } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ZOOM_LINK_LEAD_MINUTES } from "@/lib/utils";

// Timers past this get skipped rather than scheduled — setTimeout silently
// fires immediately in browsers once the delay exceeds the ~24.8-day 32-bit
// signed int limit, and slots in this app are routinely booked weeks out.
// A tab realistically won't stay open across that gap anyway; the next page
// load will just re-evaluate from the server and render the right state.
const MAX_SCHEDULABLE_MS = 12 * 60 * 60 * 1000; // 12 hours

// Renders the Zoom join/start link as a real link once active, or a
// disabled placeholder before that — matching whatever the server decided
// at render time (`initialActive`), then flips live in the browser at the
// exact activation instant with no page refresh needed, for waits under
// MAX_SCHEDULABLE_MS.
export function ZoomLinkGate({
  startsAt,
  href,
  label,
  initialActive,
  inactiveHint,
  children,
}: {
  startsAt: string;
  href: string;
  label: string;
  initialActive: boolean;
  inactiveHint?: string;
  children?: React.ReactNode; // extra content shown only once active (e.g. passcode)
}) {
  const [active, setActive] = useState(initialActive);

  useEffect(() => {
    if (active) return;
    const activationMs = new Date(startsAt).getTime() - ZOOM_LINK_LEAD_MINUTES * 60_000;
    const delay = activationMs - Date.now();
    if (delay <= 0) {
      setActive(true);
      return;
    }
    if (delay > MAX_SCHEDULABLE_MS) return;
    const timer = setTimeout(() => setActive(true), delay);
    return () => clearTimeout(timer);
  }, [active, startsAt]);

  if (active) {
    return (
      <div className="space-y-1.5">
        <a href={href} target="_blank" rel="noopener noreferrer" className={buttonVariants({ size: "sm" })}>
          <Video className="size-4" />
          {label}
        </a>
        {children}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <span
        aria-disabled="true"
        title={`Available ${ZOOM_LINK_LEAD_MINUTES} minutes before the slot`}
        className={buttonVariants({ size: "sm", variant: "outline" }) + " pointer-events-none opacity-50"}
      >
        <Video className="size-4" />
        {label}
      </span>
      {inactiveHint && <p className="text-xs text-muted-foreground">{inactiveHint}</p>}
    </div>
  );
}
