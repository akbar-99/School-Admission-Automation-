"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

// Triggers the browser print dialog → "Save as PDF" exports the page.
export function PrintButton() {
  return (
    <Button variant="outline" size="sm" type="button" onClick={() => window.print()}>
      <Printer className="size-4" />
      Print / Export PDF
    </Button>
  );
}
