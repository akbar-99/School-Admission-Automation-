"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

interface ToastMsg {
  id: number;
  text: string;
}

// Something the server already knew about when the page rendered — used for
// the "catch up" pass on mount, for anything that happened while nobody was
// on the page to catch the live Realtime event.
export interface InitialAlert {
  id: string; // dedupe key, e.g. a slot id
  text: string;
}

function seenKey(storageKey: string) {
  return `live-alerts-seen-${storageKey}`;
}

function loadSeen(storageKey: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(seenKey(storageKey));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveSeen(storageKey: string, seen: Set<string>) {
  try {
    window.localStorage.setItem(seenKey(storageKey), JSON.stringify([...seen]));
  } catch {
    // localStorage unavailable (private mode, etc.) — just skip persisting.
  }
}

// Generic popup + sound whenever something relevant changes, via two paths:
// 1. Live, through a caller-supplied Supabase Realtime subscription, for
//    anything that happens while this tab is open and connected.
// 2. A "catch up" pass on mount against `initialAlerts` (computed
//    server-side on every page load) for anything that happened while
//    nobody was on the page — deduped per-browser via localStorage so the
//    same event doesn't re-alert on every subsequent visit.
//
// `storageKey` scopes the localStorage dedupe set (e.g. a teacher id, or a
// fixed string for an admin-wide alert). `subscribe` wires up whatever
// postgres_changes listeners are relevant and calls `push(text, seenId?)`
// when something fires; passing `seenId` marks that id seen immediately so
// a page refresh right after doesn't double-alert via the catch-up pass.
export function LiveAlerts({
  storageKey,
  initialAlerts = [],
  subscribe,
}: {
  storageKey: string;
  initialAlerts?: InitialAlert[];
  subscribe: (
    supabase: SupabaseClient,
    push: (text: string, seenId?: string) => void,
  ) => RealtimeChannel;
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
          const Ctx =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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

  const pushAndMarkSeen = (text: string, seenId?: string) => {
    pushToast(text);
    if (seenId) {
      const seen = loadSeen(storageKey);
      seen.add(seenId);
      saveSeen(storageKey, seen);
    }
  };

  // Catch-up pass: anything the server already knew about on this render
  // that this browser hasn't acknowledged yet. Runs once per mount; the page
  // was just rendered fresh, so no need to router.refresh() here too.
  useEffect(() => {
    if (initialAlerts.length === 0) return;
    const seen = loadSeen(storageKey);
    const unseen = initialAlerts.filter((a) => !seen.has(a.id));
    if (unseen.length === 0) return;
    for (const a of unseen) {
      pushToast(a.text, { refresh: false });
      seen.add(a.id);
    }
    saveSeen(storageKey, seen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = subscribe(supabase, pushAndMarkSeen);
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

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
