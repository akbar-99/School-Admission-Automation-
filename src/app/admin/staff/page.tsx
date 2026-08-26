import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/utils";
import { inviteStaff, setZoomEmail, setStaffPhone, removeStaff, reactivateStaff } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { RemoveStaffButton } from "@/components/admin/remove-staff-button";
import { PhoneField } from "@/components/apply/phone-field";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import type { UserRole } from "@/lib/types";

interface StaffRow {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: UserRole;
  zoom_email: string | null;
  disabled: boolean;
  created_at: string;
}

// Roles that host assessment Zoom meetings — only these get a Zoom mapping.
const ZOOM_ROLES: UserRole[] = ["teacher", "class_teacher"];

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "marketing", label: "Marketing" },
  { value: "teacher", label: "Assessment teacher" },
  { value: "class_teacher", label: "Class teacher" },
  { value: "admin", label: "Admin" },
];

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;
  const session = await getSessionUser();
  const currentUserId = session!.profile!.id;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("users")
    .select("id, full_name, email, phone, role, zoom_email, disabled, created_at")
    .order("created_at", { ascending: true });
  const staff = (data ?? []) as StaffRow[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Staff accounts</h1>
        <p className="text-muted-foreground">
          Invite marketing, teachers, and admins. They&apos;ll get an email to set their own
          password. Add a phone number to also reach them on WhatsApp.
        </p>
      </div>

      {ok && <Alert variant="success">{ok}</Alert>}
      {error && <Alert variant="error">{error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Invite a staff member</CardTitle>
          <CardDescription>
            An invite link is emailed to the address below. The account is active once they set a password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={inviteStaff} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="full_name">Full name *</Label>
              <Input id="full_name" name="full_name" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email *</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role">Role *</Label>
              <Select id="role" name="role" required defaultValue="">
                <option value="" disabled>
                  Select…
                </option>
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone (WhatsApp)</Label>
              <PhoneField id="phone" name="phone" placeholder="9XXXXXXXXX" />
              <p className="text-xs text-muted-foreground">
                Optional — used to send them WhatsApp notifications alongside email.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="zoom_email">Zoom account email</Label>
              <Input id="zoom_email" name="zoom_email" type="email" placeholder="Defaults to login email" />
              <p className="text-xs text-muted-foreground">
                For assessment teachers — the Zoom account that hosts their meetings.
              </p>
            </div>
            <div className="flex items-end">
              <SubmitButton pendingText="Sending invite…">Send invite</SubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current staff ({staff.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {staff.length === 0 ? (
            <p className="text-sm text-muted-foreground">No staff yet.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Email (login ID)</TH>
                  <TH>Role</TH>
                  <TH>Phone (WhatsApp)</TH>
                  <TH>Zoom account</TH>
                  <TH>Added</TH>
                  <TH className="text-right">Access</TH>
                </TR>
              </THead>
              <TBody>
                {staff.map((s) => (
                  <TR key={s.id} className={s.disabled ? "opacity-60" : undefined}>
                    <TD className="whitespace-nowrap font-medium">{s.full_name ?? "—"}</TD>
                    <TD className="whitespace-nowrap text-muted-foreground">{s.email ?? "—"}</TD>
                    <TD className="whitespace-nowrap">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone="info">{s.role}</Badge>
                        <Badge tone={s.disabled ? "danger" : "success"}>
                          {s.disabled ? "Removed" : "Active"}
                        </Badge>
                      </div>
                    </TD>
                    <TD>
                      <form action={setStaffPhone} className="flex items-center gap-1.5">
                        <input type="hidden" name="user_id" value={s.id} />
                        <PhoneField
                          id={`phone-${s.id}`}
                          name="phone"
                          defaultValue={s.phone ?? ""}
                          placeholder="9XXXXXXXXX"
                        />
                        <SubmitButton
                          size="sm"
                          variant="outline"
                          pendingText="…"
                          disabled={s.disabled || undefined}
                        >
                          Save
                        </SubmitButton>
                      </form>
                    </TD>
                    <TD>
                      {ZOOM_ROLES.includes(s.role) ? (
                        <form action={setZoomEmail} className="flex items-center gap-1.5">
                          <input type="hidden" name="user_id" value={s.id} />
                          <Input
                            name="zoom_email"
                            type="email"
                            defaultValue={s.zoom_email ?? ""}
                            placeholder={s.email ?? "zoom@email"}
                            className="h-9 w-40"
                            disabled={s.disabled}
                          />
                          <SubmitButton
                            size="sm"
                            variant="outline"
                            pendingText="…"
                            disabled={s.disabled || undefined}
                          >
                            Save
                          </SubmitButton>
                        </form>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(s.created_at)}
                    </TD>
                    <TD className="whitespace-nowrap text-right">
                      {s.id === currentUserId ? (
                        <span className="text-xs text-muted-foreground">You</span>
                      ) : s.disabled ? (
                        <form action={reactivateStaff} className="inline-flex">
                          <input type="hidden" name="user_id" value={s.id} />
                          <SubmitButton size="sm" variant="outline" pendingText="…">
                            Reactivate
                          </SubmitButton>
                        </form>
                      ) : (
                        <RemoveStaffButton
                          action={removeStaff}
                          userId={s.id}
                          name={s.full_name ?? s.email ?? "this staff member"}
                        />
                      )}
                    </TD>
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
