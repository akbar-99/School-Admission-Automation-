import { Suspense } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

export default async function NotificationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Notifications &amp; audit</h1>
        <p className="text-muted-foreground">Every lifecycle message and change is recorded.</p>
      </div>

      <Suspense fallback={<NotificationsBodySkeleton />}>
        <NotificationsBody />
      </Suspense>
    </div>
  );
}

function NotificationsBodySkeleton() {
  return (
    <div className="space-y-6">
      {[0, 1].map((i) => (
        <Card key={i}>
          <CardContent className="space-y-2 pt-6">
            {[0, 1, 2].map((j) => (
              <div key={j} className="h-9 w-full animate-pulse rounded bg-muted" />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

async function NotificationsBody() {
  const admin = createSupabaseAdminClient();
  const [{ data: notifications }, { data: audit }] = await Promise.all([
    admin
      .from("notifications")
      .select("id, event, channel, recipient, subject, status, error, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("audit_logs")
      .select("id, action, entity, entity_id, actor_role, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Notifications ({notifications?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {!notifications || notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notifications yet.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Event</TH>
                  <TH>Channel</TH>
                  <TH>Recipient</TH>
                  <TH>Subject</TH>
                  <TH>Status</TH>
                  <TH>When</TH>
                </TR>
              </THead>
              <TBody>
                {notifications.map((n) => (
                  <TR key={n.id}>
                    <TD className="font-mono text-xs">{n.event}</TD>
                    <TD>{n.channel}</TD>
                    <TD className="max-w-40 truncate">{n.recipient}</TD>
                    <TD className="max-w-48 truncate">{n.subject}</TD>
                    <TD>
                      <Badge
                        tone={
                          n.status === "failed"
                            ? "danger"
                            : n.status === "read" || n.status === "delivered" || n.status === "sent"
                              ? "success"
                              : "neutral"
                        }
                      >
                        {n.status}
                      </Badge>
                      {n.status === "failed" && n.error && (
                        <div className="mt-1 max-w-56 text-xs text-muted-foreground">{n.error}</div>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-muted-foreground">{formatDateTime(n.created_at)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audit log ({audit?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {!audit || audit.length === 0 ? (
            <p className="text-sm text-muted-foreground">No audit entries yet.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Action</TH>
                  <TH>Entity</TH>
                  <TH>Actor</TH>
                  <TH>When</TH>
                </TR>
              </THead>
              <TBody>
                {audit.map((a) => (
                  <TR key={a.id}>
                    <TD className="font-mono text-xs">{a.action}</TD>
                    <TD className="text-xs text-muted-foreground">
                      {a.entity}
                      {a.entity_id ? ` · ${a.entity_id.slice(0, 8)}` : ""}
                    </TD>
                    <TD>{a.actor_role ?? "system"}</TD>
                    <TD className="whitespace-nowrap text-muted-foreground">{formatDateTime(a.created_at)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
