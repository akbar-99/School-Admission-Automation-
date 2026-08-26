"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
import { DIAL_CODES, flagEmoji } from "@/lib/dial-codes";

// Split a stored combined value (e.g. "+919995224466") back into its dial
// code + local number, for editing an existing phone number. Falls back to
// treating the whole value as a local number under `defaultIso` if no dial
// code prefix matches.
function parsePhone(value: string, defaultIso: string): { iso: string; number: string } {
  const trimmed = value.trim();
  if (trimmed.startsWith("+")) {
    const byLongestDial = [...DIAL_CODES].sort((a, b) => b.dial.length - a.dial.length);
    const match = byLongestDial.find((c) => trimmed.startsWith(c.dial));
    if (match) return { iso: match.iso, number: trimmed.slice(match.dial.length) };
  }
  return { iso: defaultIso, number: trimmed };
}

// A phone input with a searchable country-code dropdown. The visible parts are
// a code picker + a local-number <Input>; a hidden field submits the combined
// value (e.g. "+919995224466") under `name`.
export function PhoneField({
  id,
  name,
  required,
  defaultIso = "IN",
  defaultValue = "",
  placeholder = "Phone number",
}: {
  id: string;
  name: string;
  required?: boolean;
  defaultIso?: string;
  defaultValue?: string;
  placeholder?: string;
}) {
  const initial = parsePhone(defaultValue, defaultIso);
  const [iso, setIso] = useState(initial.iso);
  const [number, setNumber] = useState(initial.number);

  const options = useMemo(
    () =>
      DIAL_CODES.map((c) => ({
        value: c.iso,
        search: c.name,
        label: `${flagEmoji(c.iso)} ${c.dial} ${c.name}`,
        selectedLabel: `${flagEmoji(c.iso)} ${c.dial}`,
      })),
    [],
  );

  const dial = DIAL_CODES.find((c) => c.iso === iso)?.dial ?? "+91";
  const digits = number.replace(/[^\d]/g, "");
  const combined = digits ? `${dial}${digits}` : "";

  return (
    <div className="flex min-w-[14rem] gap-2">
      <SearchSelect
        ariaLabel="Country code"
        value={iso}
        onChange={setIso}
        options={options}
        searchPlaceholder="Country…"
        className="w-[7.5rem] shrink-0"
      />
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        required={required}
        value={number}
        onChange={(e) => setNumber(e.target.value)}
        placeholder={placeholder}
        className="min-w-[6rem] flex-1"
      />
      <input type="hidden" name={name} value={combined} />
    </div>
  );
}
