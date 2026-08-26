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
  application_id: string | null;
  teacher_id: string | null;
  claimed_by_teacher: boolean;
}

// Live popup + sound the instant something changes on this teacher's slots —
// a parent books one, or an admin (re)assigns one to them — via Supabase
// Realtime, so they don't have to keep refreshing the dashboard.
export function TeacherLiveAlerts({ teacherId }: { teacherId: string }) {
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

  const pushToast = (text: string) => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, text }]);
    playChime();
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 9000);
    router.refresh();
  };

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
          if (!before.application_id && after.application_id) {
            pushToast("A parent just booked one of your assessment slots.");
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
