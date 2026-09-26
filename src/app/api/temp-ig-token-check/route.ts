import { NextResponse } from "next/server";
import { config } from "@/lib/config";

export async function GET() {
  if (!config.notifications.instagramToken) {
    return NextResponse.json({ error: "INSTAGRAM_TOKEN not configured" }, { status: 500 });
  }
  const r = await fetch(
    `https://graph.facebook.com/v20.0/17841452944797577?fields=name,username,ig_id&access_token=${config.notifications.instagramToken}`,
  );
  const json = await r.json();
  return NextResponse.json({ status: r.status, json });
}
