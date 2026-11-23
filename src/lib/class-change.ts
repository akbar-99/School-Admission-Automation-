// Pure class-mapping rules for the admin "Change class" action. Class labels
// carry the curriculum for every grade except KG: "STD n" is CBSE and
// "STAGE n" is Cambridge (see filterClassOptionsByCurriculum in classes.ts),
// while "KG 1"/"KG 2" exist in both and the curriculum is stored separately.

export type Curriculum = "CBSE" | "Cambridge";

export interface ClassChoice {
  grade: string;
  curriculum: Curriculum | null;
}

const STD = /^\s*std\s*(\d+)\s*$/i;
const STAGE = /^\s*stage\s*(\d+)\s*$/i;
const KG = /^\s*kg\s*(\d+)\s*$/i;

export function curriculumOfGrade(grade: string): Curriculum | null {
  if (STD.test(grade)) return "CBSE";
  if (STAGE.test(grade)) return "Cambridge";
  return null;
}

export function otherCurriculum(curriculum: Curriculum): Curriculum {
  return curriculum === "CBSE" ? "Cambridge" : "CBSE";
}

// The same class in the other curriculum: STD 3 -> STAGE 3, STAGE 3 -> STD 3,
// KG 2 (CBSE) -> KG 2 (Cambridge). Null when the class or its curriculum
// can't be worked out, or the target class doesn't exist at the school.
export function otherCurriculumClass(
  grade: string,
  curriculum: Curriculum | null,
  available: readonly string[],
): ClassChoice | null {
  let target: ClassChoice | null = null;
  const std = STD.exec(grade);
  const stage = STAGE.exec(grade);
  const kg = KG.exec(grade);
  if (std) target = { grade: `STAGE ${Number(std[1])}`, curriculum: "Cambridge" };
  else if (stage) target = { grade: `STD ${Number(stage[1])}`, curriculum: "CBSE" };
  else if (kg && curriculum) target = { grade: `KG ${Number(kg[1])}`, curriculum: otherCurriculum(curriculum) };
  return target && hasClass(available, target.grade) ? target : null;
}

// One class higher, same curriculum: KG 1 -> KG 2, KG 2 -> STD 1 / STAGE 1,
// STD n -> STD n+1, STAGE n -> STAGE n+1. Null past the top class the
// school runs, or for KG 2 when its curriculum isn't known.
export function nextClass(grade: string, curriculum: Curriculum | null, available: readonly string[]): ClassChoice | null {
  let target: ClassChoice | null = null;
  const std = STD.exec(grade);
  const stage = STAGE.exec(grade);
  const kg = KG.exec(grade);
  if (std) target = { grade: `STD ${Number(std[1]) + 1}`, curriculum: "CBSE" };
  else if (stage) target = { grade: `STAGE ${Number(stage[1]) + 1}`, curriculum: "Cambridge" };
  else if (kg && Number(kg[1]) === 1) target = { grade: "KG 2", curriculum };
  else if (kg && Number(kg[1]) === 2 && curriculum) {
    target = { grade: curriculum === "CBSE" ? "STD 1" : "STAGE 1", curriculum };
  }
  return target && hasClass(available, target.grade) ? target : null;
}

function hasClass(available: readonly string[], grade: string): boolean {
  const norm = (g: string) => g.replace(/\s+/g, "").toLowerCase();
  return available.some((a) => norm(a) === norm(grade));
}

// For the change-history row: which of the two situations this is.
export function classChangeKind(
  from: ClassChoice,
  to: ClassChoice,
  available: readonly string[],
): "curriculum" | "next_class" | "other" {
  const other = otherCurriculumClass(from.grade, from.curriculum, available);
  if (other && sameChoice(other, to)) return "curriculum";
  const next = nextClass(from.grade, from.curriculum, available);
  if (next && sameChoice(next, to)) return "next_class";
  return "other";
}

function sameChoice(a: ClassChoice, b: ClassChoice): boolean {
  return a.grade.replace(/\s+/g, "").toLowerCase() === b.grade.replace(/\s+/g, "").toLowerCase() && a.curriculum === b.curriculum;
}

// "STAGE 3 (Cambridge)", "KG 2 (CBSE)", or just the grade when unknown.
export function describeClass(choice: ClassChoice): string {
  return choice.curriculum ? `${choice.grade} (${choice.curriculum})` : choice.grade;
}

// The curriculum a chosen class implies — STD/STAGE decide it; a KG class
// uses the curriculum picked alongside it.
export function resolveCurriculum(grade: string, kgCurriculum: Curriculum | null): Curriculum | null {
  return curriculumOfGrade(grade) ?? (KG.test(grade) ? kgCurriculum : null);
}
