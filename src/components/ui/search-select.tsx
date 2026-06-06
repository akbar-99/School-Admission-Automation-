"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface SearchOption {
  value: string;
  /** Text matched against the typed query (prefix match). */
  search: string;
  /** Shown in the dropdown list. */
  label: React.ReactNode;
  /** Compact label shown on the closed trigger (defaults to `label`). */
  selectedLabel?: React.ReactNode;
}

// A searchable dropdown: typing filters the list to options whose `search`
// text STARTS WITH the query (so "u" → Uganda, Ukraine, United…). Replaces a
// native <select> when the list is long. Submits via an optional hidden input.
export function SearchSelect({
  options,
  value,
  onChange,
  name,
  placeholder = "Select…",
  searchPlaceholder = "Type to search…",
  className,
  ariaLabel,
}: {
  options: SearchOption[];
  value: string;
  onChange: (value: string) => void;
  name?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;
  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.search.toLowerCase().startsWith(q)) : options;

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Reset + focus the search box each time it opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  const choose = (opt: SearchOption) => {
    onChange(opt.value);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[active]) choose(filtered[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {name && <input type="hidden" name={name} value={value} />}
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3.5 py-2 text-left text-sm shadow-soft transition-colors focus-visible:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected ? selected.selectedLabel ?? selected.label : placeholder}
        </span>
        <svg viewBox="0 0 20 20" fill="none" className="size-4 shrink-0 opacity-50" aria-hidden>
          <path
            d="M6 8l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-1 w-[16rem] max-w-[80vw] overflow-hidden rounded-md border border-border bg-card shadow-luxe">
          <div className="border-b border-border/70 p-1.5">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              className="w-full rounded-sm bg-transparent px-2 py-1.5 text-sm focus:outline-none"
            />
          </div>
          <ul className="max-h-56 overflow-auto p-1">
            {filtered.length === 0 ? (
              <li className="px-2.5 py-2 text-sm text-muted-foreground">No matches</li>
            ) : (
              filtered.map((o, i) => (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => choose(o)}
                    onMouseEnter={() => setActive(i)}
                    ref={(el) => {
                      if (i === active && el) el.scrollIntoView({ block: "nearest" });
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm",
                      i === active && "bg-secondary",
                    )}
                  >
                    <span className="truncate">{o.label}</span>
                    {o.value === value && <span className="shrink-0 text-primary">✓</span>}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
