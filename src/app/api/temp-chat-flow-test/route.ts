import { NextResponse } from "next/server";
import { sendInstagramMessage } from "@/lib/instagram";

export async function GET() {
  // Real test IGSID from earlier this session (akbaraboobakkar), should be
  // within the 24h messaging window.
  const result = await sendInstagramMessage("1793772005097201", "This is a test reply sent directly from the admissions app.");
  return NextResponse.json(result);
}
