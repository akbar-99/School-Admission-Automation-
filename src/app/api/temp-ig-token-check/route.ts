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
  const encoded = encodeURIComponent(token);
  const meRes = await fetch(
    `https://graph.instagram.com/v20.0/me?fields=user_id,username,name,account_type&access_token=${encoded}`,
  );
  const meJson = await meRes.json();

  const otherRes = await fetch(
    `https://graph.instagram.com/v20.0/17841452944797577?fields=name,username&access_token=${encoded}`,
  );
  const otherJson = await otherRes.json();

  return NextResponse.json({
    diagnostics,
    me: { status: meRes.status, json: meJson },
    otherUserLookup: { status: otherRes.status, json: otherJson },
  });
}
