import { requireRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Streams an Instagram/Facebook DM attachment (voice note, photo, video)
// back through our own server instead of pointing the browser straight at
// Meta's signed CDN URL. Two reasons: (1) Meta serves Instagram voice notes
// with `Content-Type: video/mp4` even though they're audio-only — browsers
// won't play that through an <audio> element, so this re-labels it
// `audio/mp4`, which they do play; (2) it keeps the raw signed CDN URL out
// of the client, auth-gated the same way the conversation page itself is.
const MESSAGES_TABLE: Record<string, string> = {
  instagram: "instagram_messages",
  facebook: "facebook_messages",
};

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ platform: string; messageId: string }> },
) {
  const { platform, messageId } = await ctx.params;
  const messagesTable = MESSAGES_TABLE[platform];
  if (!messagesTable) return new Response("Not found", { status: 404 });

  const { profile } = await requireRole(["marketing", "admin", "coo"]);
  const admin = createSupabaseAdminClient();

  const { data: message } = await admin
    .from(messagesTable)
    .select("application_id, attachment_url, attachment_type")
    .eq("id", messageId)
    .maybeSingle();
  if (!message?.attachment_url) return new Response("Not found", { status: 404 });

  const { data: app } = await admin
    .from("applications")
    .select("created_by")
    .eq("id", message.application_id)
    .maybeSingle();
  if (!app) return new Response("Not found", { status: 404 });
  if (profile.role === "marketing" && app.created_by !== profile.id) {
    return new Response("Not found", { status: 404 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(message.attachment_url);
  } catch (err) {
    console.error("[media-proxy] fetch failed", err);
    return new Response("Upstream fetch failed", { status: 502 });
  }
  if (!upstream.ok) return new Response("Upstream fetch failed", { status: 502 });

  const bytes = await upstream.arrayBuffer();
  const contentType =
    message.attachment_type === "audio" ? "audio/mp4" : upstream.headers.get("content-type") ?? "application/octet-stream";

  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
