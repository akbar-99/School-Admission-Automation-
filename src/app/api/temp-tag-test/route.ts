import { NextResponse } from "next/server";
import { sendInstagramMessage } from "@/lib/instagram";

export async function GET() {
  const result = await sendInstagramMessage("1793772005097201", "Testing the HUMAN_AGENT tag on replies.");
  return NextResponse.json(result);
}
