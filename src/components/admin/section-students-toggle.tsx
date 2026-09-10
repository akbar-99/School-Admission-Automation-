"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { STATUS_LABEL, type AppStatus } from "@/lib/types";
import { transferStudentSection } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";

export interface SectionStudentRow {
  id: string; // application id
  studentName: string;
  parentName: string;
  admissionNumber: string | null;
  status: AppStatus;
}

export interface TransferTargetSection {
  id: string;
  name: string | null;
  batch: string | null;
  filled: number;
  capacity: number;
}

function targetLabel(t: TransferTargetSection): string {
  const parts = [t.name, t.batch].filter(Boolean);
  return parts.length ? parts.join(" — ") : "(unnamed)";
}

function StudentRow({
  student,
  currentSectionId,
  targetSections,
}: {
  student: SectionStudentRow;
  currentSectionId: string;
  targetSections: TransferTargetSection[];
}) {
  const [transferOpen, setTransferOpen] = useState(false);
  const options = targetSections.filter((t) => t.id !== currentSectionId);

  return (
    <div className="p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/admin/applications/${student.id}`} className="hover:underline">
          <div className="font-medium">{student.studentName}</div>
          <div className="text-xs text-muted-foreground">
            {student.parentName} · {STATUS_LABEL[student.status] ?? student.status}
          </div>
        </Link>
        <div className="flex items-center gap-3">
          <div className="font-mono text-xs text-muted-foreground">{student.admissionNumber ?? "—"}</div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setTransferOpen((o) => !o)}
            disabled={options.length === 0}
          >
            Transfer
          </Button>
        </div>
      </div>

      {transferOpen && (
        <form
          action={transferStudentSection}
          className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 p-2"
        >
          <input type="hidden" name="application_id" value={student.id} />
          <label className="text-xs text-muted-foreground">Move to:</label>
          <select
            name="new_section_id"
            className="h-9 rounded-md border border-input bg-card px-2 text-sm"
            required
          >
            {options.map((t) => (
              <option key={t.id} value={t.id} disabled={t.filled >= t.capacity}>
                {targetLabel(t)} ({t.filled}/{t.capacity}
                {t.filled >= t.capacity ? " · full" : ""})
              </option>
            ))}
          </select>
          <SubmitButton size="sm" pendingText="Moving…">
            Move
          </SubmitButton>
        </form>
      )}
    </div>
  );
}

export function SectionStudentsToggle({
  label,
  students,
  currentSectionId,
  targetSections,
}: {
  label: ReactNode;
  students: SectionStudentRow[];
  currentSectionId: string;
  targetSections: TransferTargetSection[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-left font-medium hover:text-primary"
      >
        <span>{label}</span>
        <span className="text-xs font-normal text-muted-foreground">
          ({students.length} enrolled) {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="mt-2 divide-y divide-border overflow-hidden rounded-md border border-border">
          {students.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No students enrolled yet.</p>
          ) : (
            students.map((s) => (
              <StudentRow
                key={s.id}
                student={s}
                currentSectionId={currentSectionId}
                targetSections={targetSections}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
