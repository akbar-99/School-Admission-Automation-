import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/utils";
import { sendInstagramReply } from "../../actions";
import { StatusBadge } from "@/components/status-badge";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Application } from "@/lib/types";

interface Message {
  id: string;
  direction: "inbound" | "outbound";
  message_text: string;
  sent_by: string | null;
  created_at: string;
}

export default async function LeadConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const { profile } = await requireRole(["marketing", "admin", "coo"]);
  const admin = createSupabaseAdminClient();

  const { data: appRow } = await admin.from("applications").select("*").eq("id", id).maybeSingle();
  if (!appRow) notFound();
  const app = appRow as Application;
  if (profile.role === "marketing" && app.created_by !== profile.id) notFound();
  if (!app.external_contact_id) notFound();

  const [{ data: parent }, { data: messagesData }] = await Promise.all([
    admin.from("parents").select("full_name").eq("id", app.parent_id).maybeSingle(),
    admin
      .from("instagram_messages")
      .select("id, direction, message_text, sent_by, created_at")
      .eq("application_id", id)
      .order("created_at", { ascending: true }),
  ]);
  const messages = (messagesData ?? []) as Message[];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/marketing" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to Leads
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl font-semibold tracking-tight">{parent?.full_name ?? "—"}</h1>
          <StatusBadge status={app.status} />
        </div>
        <p className="text-muted-foreground">
          Instagram {app.lead_source_other ?? ""} — messages sent here go straight to their Instagram DMs.
        </p>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Conversation</CardTitle>
          <CardDescription>
            Instagram only allows replies within ~24 hours of their last message — if a send fails, that&apos;s
            usually why.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex max-h-[28rem] flex-col gap-2.5 overflow-y-auto rounded-lg border border-border bg-muted/20 p-4">
            {messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">No messages yet.</p>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={cn("flex flex-col gap-0.5", m.direction === "outbound" ? "items-end" : "items-start")}
                >
                  <div
                    className={cn(
                      "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm",
                      m.direction === "outbound"
                        ? "bg-primary text-primary-foreground"
                        : "bg-card text-foreground shadow-soft",
                    )}
                  >
                    {m.message_text}
                  </div>
                  <span className="px-1 text-[11px] text-muted-foreground">
                    {m.direction === "outbound" && !m.sent_by && "Sent from the Instagram app · "}
                    {formatDateTime(m.created_at)}
                  </span>
                </div>
              ))
            )}
          </div>

          <form action={sendInstagramReply} className="flex items-end gap-2.5">
            <input type="hidden" name="application_id" value={app.id} />
            <Textarea name="message" placeholder="Type a reply…" required className="flex-1" rows={2} />
            <SubmitButton pendingText="Sending…">Send</SubmitButton>
          </form>
        </CardContent>
      </Card>

      <Link href="/marketing" className={buttonVariants({ variant: "ghost", size: "sm" })}>
        Back to Leads
      </Link>
    </div>
  );
}
