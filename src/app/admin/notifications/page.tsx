import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

export default async function NotificationsPage() {
  const admin = createSupabaseAdminClient();
  const [{ data: notifications }, { data: audit }] = await Promise.all([
    admin
      .from("notifications")
      .select("id, event, channel, recipient, subject, status, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("audit_logs")
      .select("id, action, entity, entity_id, actor_role, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Notifications &amp; audit</h1>
        <p className="text-muted-foreground">Every lifecycle message and change is recorded.</p>
      </div>

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
                      <Badge tone={n.status === "sent" ? "success" : n.status === "failed" ? "danger" : "neutral"}>
                        {n.status}
                      </Badge>
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
    </div>
  );
}
