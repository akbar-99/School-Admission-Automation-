"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";

export interface FollowUpAlert {
  id: string; // dedupe key — includes the follow-up date, so a re-picked date pops again
  text: string;
}

function storageKeyFor(staffId: string) {
  return `follow-up-seen-${staffId}`;
}

function loadSeen(staffId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(storageKeyFor(staffId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveSeen(staffId: string, seen: Set<string>) {
  try {
    window.localStorage.setItem(storageKeyFor(staffId), JSON.stringify([...seen]));
  } catch {
    // localStorage unavailable (private mode, etc.) — just skip persisting.
  }
}

// A centered, blocking modal (matches the Team dashboard's drill-down
// modal) rather than the small corner-toast style LiveAlerts uses
// elsewhere — a reminder a counselor is expected to actually act on reads
// better as something that stops them, not something easy to miss in a
// corner. Lists every due lead in ONE modal rather than stacking one popup
// per lead. Purpose-built rather than a LiveAlerts variant: the
// one-modal-with-a-list interaction here doesn't map onto LiveAlerts'
// one-toast-per-event model.
export function LeadFollowUpAlerts({
  staffId,
  initialAlerts = [],
}: {
  staffId: string;
  initialAlerts?: FollowUpAlert[];
}) {
  const [unseen, setUnseen] = useState<FollowUpAlert[]>([]);
  const [open, setOpen] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (initialAlerts.length === 0) return;
    const seen = loadSeen(staffId);
    const due = initialAlerts.filter((a) => !seen.has(a.id));
    if (due.length === 0) return;
    setUnseen(due);
    setOpen(true);
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const now = ctx.currentTime;
      [0, 0.22].forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.35, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.2);
      });
    } catch {
      // Autoplay blocked or unsupported — the modal still shows, just silently.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffId]);

  function dismiss() {
    const seen = loadSeen(staffId);
    for (const a of unseen) seen.add(a.id);
    saveSeen(staffId, seen);
    setOpen(false);
  }

  if (!open || unseen.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={dismiss}>
      <div
        className="w-full max-w-sm overflow-hidden rounded-xl bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Bell className="size-4.5 shrink-0 text-primary" />
            <div className="font-display text-lg font-semibold">
              Follow-up{unseen.length > 1 ? "s" : ""} due
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto p-5">
          {unseen.map((a) => (
            <p key={a.id} className="rounded-lg border border-border bg-muted/30 px-3.5 py-2.5 text-sm">
              {a.text}
            </p>
          ))}
        </div>
        <div className="border-t border-border px-5 py-3 text-right">
          <button
            type="button"
            onClick={dismiss}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:brightness-[1.06]"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
