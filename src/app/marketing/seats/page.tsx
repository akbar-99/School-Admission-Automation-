import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Section } from "@/lib/types";

// Marketing-facing, read-only view of seat availability per grade so the team
// can set parent expectations. Capacity changes remain admin-only.
export default async function MarketingSeatsPage() {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sections")
    .select("*")
    .order("grade", { ascending: true })
    .order("name", { ascending: true });
  const sections = (data ?? []) as Section[];

  const byGrade = sections.reduce<Record<string, Section[]>>((acc, s) => {
    (acc[s.grade] ??= []).push(s);
    return acc;
  }, {});

  const avail = (s: Section) => Math.max(0, s.capacity - s.filled);
  const totalAvailable = sections.reduce((n, s) => n + avail(s), 0);
  const totalCapacity = sections.reduce((n, s) => n + s.capacity, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Seat availability</h1>
        <p className="text-muted-foreground">
          Live open seats per grade. Seats fill A → B → C as students enrol.
        </p>
      </div>

      <Card>
        <CardContent className="flex items-center justify-between py-5">
          <div>
            <div className="text-sm text-muted-foreground">Total seats open</div>
            <div className="font-display text-2xl font-semibold">
              {totalAvailable}{" "}
              <span className="text-base font-normal text-muted-foreground">
                of {totalCapacity}
              </span>
            </div>
          </div>
          <Badge tone={totalAvailable > 0 ? "success" : "danger"}>
            {totalAvailable > 0 ? "Seats available" : "All full"}
          </Badge>
        </CardContent>
      </Card>

      {sections.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No sections configured yet. Ask an admin to add class sections.
          </CardContent>
        </Card>
      ) : (
        Object.entries(byGrade).map(([grade, list]) => {
          const gradeAvail = list.reduce((n, s) => n + avail(s), 0);
          const gradeCap = list.reduce((n, s) => n + s.capacity, 0);
          return (
            <Card key={grade}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{grade}</CardTitle>
                    <CardDescription>
                      {gradeAvail} of {gradeCap} seats open
                    </CardDescription>
                  </div>
                  <Badge tone={gradeAvail > 0 ? "success" : "danger"}>
                    {gradeAvail > 0
                      ? `${gradeAvail} seat${gradeAvail === 1 ? "" : "s"} open`
                      : "Full"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {list.map((s) => {
                  const open = avail(s);
                  const pct = Math.min(100, Math.round((s.filled / s.capacity) * 100));
                  const full = open === 0;
                  return (
                    <div key={s.id} className="rounded-md border border-border p-3">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">Section {s.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {full ? "Full" : `${open} open`} · {s.filled}/{s.capacity}
                        </div>
                      </div>
                      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={full ? "h-full bg-destructive" : "h-full bg-primary"}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
