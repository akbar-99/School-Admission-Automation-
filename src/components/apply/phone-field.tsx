"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
import { DIAL_CODES, flagEmoji } from "@/lib/dial-codes";

// A phone input with a searchable country-code dropdown. The visible parts are
// a code picker + a local-number <Input>; a hidden field submits the combined
// value (e.g. "+919995224466") under `name`.
export function PhoneField({
  id,
  name,
  required,
  defaultIso = "IN",
  placeholder = "Phone number",
}: {
  id: string;
  name: string;
  required?: boolean;
  defaultIso?: string;
  placeholder?: string;
}) {
  const [iso, setIso] = useState(defaultIso);
  const [number, setNumber] = useState("");

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
    <div className="flex gap-2">
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
        className="flex-1"
      />
      <input type="hidden" name={name} value={combined} />
    </div>
  );
}
