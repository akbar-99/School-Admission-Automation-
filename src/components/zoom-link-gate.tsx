"use client";

import { useEffect, useState } from "react";
import { Video } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ZOOM_LINK_LEAD_MINUTES, MAX_SCHEDULABLE_TIMER_MS } from "@/lib/utils";

// Renders the Zoom join/start link as a real link once active, or a
// disabled placeholder before that — matching whatever the server decided
// at render time (`initialActive`), then flips live in the browser at the
// exact activation instant with no page refresh needed, for waits under
// MAX_SCHEDULABLE_TIMER_MS.
export function ZoomLinkGate({
  startsAt,
  endsAt,
  href,
  label,
  initialActive,
  inactiveHint,
  children,
}: {
  startsAt: string;
  endsAt?: string | null;
  href: string;
  label: string;
  initialActive: boolean;
  inactiveHint?: string;
  children?: React.ReactNode; // extra content shown only once active (e.g. passcode)
}) {
  const [active, setActive] = useState(initialActive);

  useEffect(() => {
    if (active) return;
    // Already past the slot's end — nothing to schedule, this one just stays
    // inactive. Without this check, a slot with initialActive=false *because*
    // it's over would still compute a start-based delay of "already past" below
    // and wrongly flip itself back on.
    if (endsAt && Date.now() > new Date(endsAt).getTime()) return;
    const activationMs = new Date(startsAt).getTime() - ZOOM_LINK_LEAD_MINUTES * 60_000;
    const delay = activationMs - Date.now();
    if (delay <= 0) {
      setActive(true);
      return;
    }
    if (delay > MAX_SCHEDULABLE_TIMER_MS) return;
    const timer = setTimeout(() => setActive(true), delay);
    return () => clearTimeout(timer);
  }, [active, startsAt, endsAt]);

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

  const isOver = endsAt ? Date.now() > new Date(endsAt).getTime() : false;

  return (
    <div className="space-y-1.5">
      <span
        aria-disabled="true"
        title={isOver ? "This slot has ended" : `Available ${ZOOM_LINK_LEAD_MINUTES} minutes before the slot`}
        className={buttonVariants({ size: "sm", variant: "outline" }) + " pointer-events-none opacity-50"}
      >
        <Video className="size-4" />
        {label}
      </span>
      {!isOver && inactiveHint && <p className="text-xs text-muted-foreground">{inactiveHint}</p>}
    </div>
  );
}
