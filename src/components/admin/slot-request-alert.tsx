"use client";

import { useEffect, useRef, useState } from "react";

// Alerts the admin when Grade applicants are waiting for an assessment slot.
// Shows on load if any are pending, and pops up when new ones arrive (polled).
// Acknowledged count is kept in sessionStorage so it doesn't re-nag while
// navigating between admin pages in the same session.
const ACK_KEY = "slotReqAck";

export function SlotRequestAlert({ initialCount }: { initialCount: number }) {
  const [count, setCount] = useState(initialCount);
  const [open, setOpen] = useState(false);
  const ackRef = useRef(0);

  useEffect(() => {
    const stored = Number(sessionStorage.getItem(ACK_KEY) ?? "0");
    ackRef.current = Number.isFinite(stored) ? stored : 0;
    if (initialCount > ackRef.current) setOpen(true);

    const tick = async () => {
      try {
        const res = await fetch("/api/admin/pending-requests", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const c = Number(data.count) || 0;
        setCount(c);
        if (c > ackRef.current) {
          setOpen(true);
        } else if (c < ackRef.current) {
          // Some were handled — lower the baseline so future requests re-alert.
          ackRef.current = c;
          sessionStorage.setItem(ACK_KEY, String(c));
        }
      } catch {
        /* ignore transient errors */
      }
    };
    const id = setInterval(tick, 25000);
    return () => clearInterval(id);
  }, [initialCount]);

  const dismiss = () => {
    ackRef.current = count;
    sessionStorage.setItem(ACK_KEY, String(count));
    setOpen(false);
  };

  if (!open || count <= 0) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6 shadow-luxe">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl">
            🔔
          </span>
          <h2 className="font-display text-xl font-semibold tracking-tight">
            New assessment request
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {count} applicant{count > 1 ? "s are" : " is"} waiting for an assessment slot to be
          scheduled.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary"
          >
            Dismiss
          </button>
          <a
            href="/admin/assessments"
            onClick={dismiss}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            View requests
          </a>
        </div>
      </div>
    </div>
  );
}
