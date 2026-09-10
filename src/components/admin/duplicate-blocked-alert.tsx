"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// Blocking popup + audible alert shown when the ERP class-webhook reports a
// 409 conflict on section creation — i.e. the class the admin just tried to
// create already exists in the ERP. Distinct from the plain inline error
// Alert (which every other form error uses) because a silent duplicate class
// is easy to miss; this needs to actually stop the admin and be heard.
export function DuplicateBlockedAlert({ message }: { message: string }) {
  const [open, setOpen] = useState(true);
  const router = useRouter();
  const playedRef = useRef(false);

  useEffect(() => {
    if (playedRef.current) return;
    playedRef.current = true;
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioContextClass();
      const now = ctx.currentTime;
      // Two short beeps rather than one — reads as an alert, not a UI blip.
      [0, 0.22].forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.18);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.2);
      });
      setTimeout(() => ctx.close(), 600);
    } catch {
      // Autoplay/audio blocked by the browser — the visible popup still gets
      // the message across regardless.
    }
  }, []);

  function close() {
    setOpen(false);
    router.replace("/admin/sections");
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border border-destructive bg-card p-6 shadow-lg">
        <div className="flex items-center gap-2 text-destructive">
          <span className="text-2xl" aria-hidden>
            ⛔
          </span>
          <h2 className="text-lg font-semibold">Duplicate class blocked</h2>
        </div>
        <p className="mt-3 text-sm text-foreground">{message}</p>
        <Button variant="destructive" className="mt-5 w-full" onClick={close}>
          OK
        </Button>
      </div>
    </div>
  );
}
