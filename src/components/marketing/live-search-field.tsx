"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";

// Updates the URL's `q` param automatically, debounced, so the leads list
// re-filters as the user types instead of waiting for the Filter button.
// Every other filter (status/from/to/view) rides along unchanged, read
// straight from the current URL at the moment the debounce fires.
export function LiveSearchField({ defaultValue }: { defaultValue: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(defaultValue);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) {
        params.set("q", value);
      } else {
        params.delete("q");
      }
      router.push(`${pathname}?${params.toString()}#leads`);
    }, 350);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
    // Only re-run when the typed value changes — searchParams/router/pathname
    // are read fresh inside the callback, not reasons to reschedule it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <Input
      id="q"
      name="q"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder="Parent, student, or phone"
      className="w-56"
      autoComplete="off"
    />
  );
}
