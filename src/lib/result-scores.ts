// The rule for recording an assessment result: every subject needs a score
// from 0 up to its maximum. Shared by the teacher's "Record result" button
// (which stays disabled until it holds) and submitResult on the server
// (which refuses otherwise), so the two can't drift apart. Mirrors
// parseSubjects in src/app/teacher/actions.ts: a blank or invalid maximum
// counts as 100.

export interface ScoreEntry {
  subject: string;
  score: string;
  max: string;
}

export function effectiveMax(maxRaw: string): number {
  const trimmed = maxRaw.trim();
  const max = trimmed === "" ? 100 : Number(trimmed);
  return Number.isFinite(max) && max > 0 ? max : 100;
}

export function isValidScore(scoreRaw: string, maxRaw: string): boolean {
  const trimmed = scoreRaw.trim();
  if (trimmed === "") return false;
  const score = Number(trimmed);
  return Number.isFinite(score) && score >= 0 && score <= effectiveMax(maxRaw);
}

// Reads the form's subject_count / subject_i / score_i / max_i fields
// through any getter (FormData on the server, form elements in the browser).
export function scoreEntriesFromForm(get: (name: string) => string | null): ScoreEntry[] {
  const count = Number(get("subject_count") ?? 0);
  const entries: ScoreEntry[] = [];
  for (let i = 0; i < count; i++) {
    const subject = (get(`subject_${i}`) ?? "").trim();
    if (!subject) continue;
    entries.push({ subject, score: get(`score_${i}`) ?? "", max: get(`max_${i}`) ?? "" });
  }
  return entries;
}

// Subjects still missing a valid score, in form order.
export function subjectsMissingScores(entries: readonly ScoreEntry[]): string[] {
  return entries.filter((e) => !isValidScore(e.score, e.max)).map((e) => e.subject);
}
