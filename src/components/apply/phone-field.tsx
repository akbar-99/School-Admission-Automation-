"use client";

import { useState } from "react";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { DIAL_CODES, flagEmoji } from "@/lib/dial-codes";

// A phone input with a country-code dropdown. The visible parts are a code
// <Select> + a local-number <Input>; a hidden field submits the combined
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

  const dial = DIAL_CODES.find((c) => c.iso === iso)?.dial ?? "+91";
  const digits = number.replace(/[^\d]/g, "");
  const combined = digits ? `${dial}${digits}` : "";

  return (
    <div className="flex gap-2">
      <Select
        aria-label="Country code"
        value={iso}
        onChange={(e) => setIso(e.target.value)}
        className="w-[8.5rem] shrink-0"
      >
        {DIAL_CODES.map((c) => (
          <option key={c.iso} value={c.iso}>
            {flagEmoji(c.iso)} {c.dial} {c.name}
          </option>
        ))}
      </Select>
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
