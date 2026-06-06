import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { adjustCapacity, createSection, updateSection, deleteSection } from "../actions";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import type { Section } from "@/lib/types";

export default async function SectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Class sections &amp; capacity</h1>
        <p className="text-muted-foreground">
          Seats fill A → B → C automatically. Add, edit or remove sections here.
        </p>
      </div>

      {ok && <Alert variant="success">{ok}</Alert>}
      {error && <Alert variant="error">{error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Add a section</CardTitle>
          <CardDescription>Create a new division for a grade.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createSection} className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="grade">Grade</Label>
              <Input id="grade" name="grade" placeholder="KG 1 / G1" className="w-28" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">Section</Label>
              <Input id="name" name="name" placeholder="C" className="w-24" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="capacity">Capacity</Label>
              <Input id="capacity" name="capacity" type="number" defaultValue={30} className="w-28" />
            </div>
            <SubmitButton pendingText="Creating…">Add section</SubmitButton>
          </form>
        </CardContent>
      </Card>

      {Object.entries(byGrade).map(([grade, list]) => (
        <Card key={grade}>
          <CardHeader>
            <CardTitle>{grade}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {list.map((s) => {
              const pct = Math.min(100, Math.round((s.filled / s.capacity) * 100));
              const full = s.filled >= s.capacity;
              return (
                <div key={s.id} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">Section {s.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {s.filled} / {s.capacity} seats {full && "· full"}
                    </div>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={full ? "h-full bg-destructive" : "h-full bg-primary"}
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    {/* Edit grade / section / capacity */}
                    <form action={updateSection} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="section_id" value={s.id} />
                      <div className="space-y-1">
                        <Label htmlFor={`grade-${s.id}`} className="text-xs">Grade</Label>
                        <Input id={`grade-${s.id}`} name="grade" defaultValue={s.grade} className="h-9 w-24" required />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`name-${s.id}`} className="text-xs">Section</Label>
                        <Input id={`name-${s.id}`} name="name" defaultValue={s.name} className="h-9 w-16" required />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`cap-${s.id}`} className="text-xs">Capacity</Label>
                        <Input
                          id={`cap-${s.id}`}
                          name="capacity"
                          type="number"
                          min={s.filled}
                          defaultValue={s.capacity}
                          className="h-9 w-24"
                          required
                        />
                      </div>
                      <SubmitButton size="sm" variant="outline" pendingText="Saving…">
                        Save
                      </SubmitButton>
                    </form>

                    {/* Quick +5 seats */}
                    <form action={adjustCapacity}>
                      <input type="hidden" name="section_id" value={s.id} />
                      <input type="hidden" name="delta" value="5" />
                      <SubmitButton size="sm" variant="outline" pendingText="Adding…">
                        +5 seats
                      </SubmitButton>
                    </form>

                    {/* Delete (only when empty) */}
                    {s.filled === 0 ? (
                      <form action={deleteSection}>
                        <input type="hidden" name="section_id" value={s.id} />
                        <SubmitButton size="sm" variant="destructive" pendingText="Deleting…">
                          Delete
                        </SubmitButton>
                      </form>
                    ) : (
                      <span className="pb-1.5 text-xs text-muted-foreground">
                        Empty before deleting
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
