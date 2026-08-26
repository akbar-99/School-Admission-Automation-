"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

interface ToastMsg {
  id: number;
  text: string;
}

interface SlotChangeRow {
  id: string;
  application_id: string | null;
  teacher_id: string | null;
  claimed_by_teacher: boolean;
}

// A booked slot the server already knows about when the page renders — used
// for the "catch up" pass on load, for anything that happened while the
// teacher wasn't on the page to catch the live Realtime event.
export interface InitialAlert {
  id: string; // slot id — also the localStorage dedupe key
  text: string;
}

const seenKey = (teacherId: string) => `teacher-seen-slots-${teacherId}`;

function loadSeen(teacherId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(seenKey(teacherId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveSeen(teacherId: string, seen: Set<string>) {
  try {
    window.localStorage.setItem(seenKey(teacherId), JSON.stringify([...seen]));
  } catch {
    // localStorage unavailable (private mode, etc.) — just skip persisting.
  }
}

// Popup + sound whenever something changes on this teacher's slots — a
// parent books one, or an admin (re)assigns one to them. Two paths:
// 1. Live, via Supabase Realtime, for anything that happens while this tab
//    is open and connected.
// 2. A "catch up" pass on mount against `initialAlerts` (computed
//    server-side on every page load) for anything that happened while the
//    teacher wasn't on the page — deduped per-browser via localStorage so
//    the same booking doesn't re-alert on every subsequent visit.
export function TeacherLiveAlerts({
  teacherId,
  initialAlerts = [],
}: {
  teacherId: string;
  initialAlerts?: InitialAlert[];
}) {
  const router = useRouter();
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const idRef = useRef(0);

  // Browsers block audio before any user gesture — prime an AudioContext on
  // the first click/keypress so the beep is guaranteed to play afterward.
  useEffect(() => {
    const unlock = () => {
      if (!audioCtxRef.current) {
        try {
          const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          audioCtxRef.current = new Ctx();
        } catch {
          // Web Audio unsupported — popups still show, just silently.
        }
      }
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const playChime = () => {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = audioCtxRef.current ?? new Ctx();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") void ctx.resume();
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
      // Autoplay blocked or unsupported — the visual popup still shows.
    }
  };

  const pushToast = (text: string, opts: { refresh?: boolean } = {}) => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, text }]);
    playChime();
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 9000);
    if (opts.refresh !== false) router.refresh();
  };

  // Catch-up pass: anything the server already knew about on this render
  // that this browser hasn't acknowledged yet. Runs once per mount; the page
  // was just rendered fresh, so no need to router.refresh() here too.
  useEffect(() => {
    if (initialAlerts.length === 0) return;
    const seen = loadSeen(teacherId);
    const unseen = initialAlerts.filter((a) => !seen.has(a.id));
    if (unseen.length === 0) return;
    for (const a of unseen) {
      pushToast(a.text, { refresh: false });
      seen.add(a.id);
    }
    saveSeen(teacherId, seen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherId]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`teacher-slots-${teacherId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "assessment_slots",
          filter: `teacher_id=eq.${teacherId}`,
        },
        (payload) => {
          const before = payload.old as Partial<SlotChangeRow>;
          const after = payload.new as SlotChangeRow;
          const markSeen = () => {
            const seen = loadSeen(teacherId);
            seen.add(after.id);
            saveSeen(teacherId, seen);
          };
          if (!before.application_id && after.application_id) {
            pushToast("A parent just booked one of your assessment slots.");
            markSeen();
          } else if (
            before.teacher_id !== teacherId &&
            after.teacher_id === teacherId &&
            !after.claimed_by_teacher
          ) {
            // teacher_id newly == me, but not via my own claim action.
            pushToast("An admin assigned a slot to you.");
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "assessment_slots",
          filter: `teacher_id=eq.${teacherId}`,
        },
        () => {
          pushToast("A new assessment slot has been assigned to you.");
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [teacherId]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-80 max-w-[90vw] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-primary/30 bg-card p-3 text-sm shadow-luxe"
        >
          <Bell className="mt-0.5 size-4 shrink-0 text-primary" />
          <span className="flex-1">{t.text}</span>
          <button
            type="button"
            onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
