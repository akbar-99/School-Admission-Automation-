import { NextResponse } from "next/server";
import { config } from "@/lib/config";

export async function GET() {
  const token = config.notifications.instagramToken;
  if (!token) {
    return NextResponse.json({ error: "INSTAGRAM_TOKEN not configured" }, { status: 500 });
  }
  const diagnostics = {
    length: token.length,
    preview: `${token.slice(0, 8)}...${token.slice(-8)}`,
    hasWhitespace: /\s/.test(token),
    hasQuotes: token.startsWith('"') || token.endsWith('"') || token.startsWith("'") || token.endsWith("'"),
  };
  const r = await fetch(
    `https://graph.facebook.com/v20.0/17841452944797577?fields=name,username,ig_id&access_token=${encodeURIComponent(config.notifications.instagramToken)}`,
  );
  const json = await r.json();
  return NextResponse.json({ status: r.status, json, diagnostics });
}
