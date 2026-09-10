"use client";

import { useState } from "react";
import { SearchSelect, type SearchOption } from "@/components/ui/search-select";
import { MoreHorizontal, Users } from "lucide-react";
import { InstagramIcon, FacebookIcon, WhatsappIcon, GoogleIcon } from "@/components/icons/lead-source-icons";

const OPTIONS: SearchOption[] = [
  { value: "instagram", search: "instagram", label: <Row icon={<InstagramIcon className="size-4" />} text="Instagram" /> },
  { value: "facebook", search: "facebook", label: <Row icon={<FacebookIcon className="size-4" />} text="Facebook" /> },
  { value: "whatsapp", search: "whatsapp", label: <Row icon={<WhatsappIcon className="size-4" />} text="WhatsApp" /> },
  { value: "google", search: "google", label: <Row icon={<GoogleIcon className="size-4" />} text="Google" /> },
  { value: "referral", search: "referral", label: <Row icon={<Users className="size-4 text-muted-foreground" />} text="Referral" /> },
  { value: "other", search: "other", label: <Row icon={<MoreHorizontal className="size-4 text-muted-foreground" />} text="Other" /> },
];

function Row({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="flex items-center gap-2">
      {icon}
      {text}
    </span>
  );
}

export function LeadSourceSelect({ name = "lead_source" }: { name?: string }) {
  const [value, setValue] = useState("");
  return (
    <SearchSelect
      name={name}
      options={OPTIONS}
      value={value}
      onChange={setValue}
      placeholder="Select source"
      searchPlaceholder="Type to filter…"
      ariaLabel="Source of enquiry"
    />
  );
}
