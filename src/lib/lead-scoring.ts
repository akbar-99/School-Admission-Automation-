// Hot/Warm/Cold lead scoring — six questions a counselor answers from a
// call, each worth points toward a 100-point total. Hardcoded for now (not
// admin-configurable); src/app/admin/actions.ts and the marketing UI both
// import from here as the single source of the rubric.
export type Temperature = "HOT" | "WARM" | "COLD";

export interface ScoreAnswerOption {
  id: string;
  label: string;
  points: number;
}

export interface ScoreQuestion {
  id: string;
  label: string;
  options: ScoreAnswerOption[];
}

export const SCORE_QUESTIONS: ScoreQuestion[] = [
  {
    id: "start_timing",
    label: "When do they want to start?",
    options: [
      { id: "within_30_days", label: "Within 30 days", points: 25 },
      { id: "within_3_months", label: "Within 3 months", points: 15 },
      { id: "later_unsure", label: "Later / not sure", points: 0 },
    ],
  },
  {
    id: "fees_discussed",
    label: "Fees discussed?",
    options: [
      { id: "comfortable", label: "Discussed, comfortable", points: 20 },
      { id: "hesitant", label: "Discussed, hesitant", points: 8 },
      { id: "not_yet", label: "Not yet", points: 0 },
    ],
  },
  {
    id: "demo_class",
    label: "Demo class",
    options: [
      { id: "attended", label: "Attended", points: 20 },
      { id: "booked", label: "Booked", points: 10 },
      { id: "none_yet", label: "None yet", points: 0 },
    ],
  },
  {
    id: "decision_maker",
    label: "Decision-maker involved?",
    options: [
      { id: "yes", label: "Yes", points: 10 },
      { id: "no_unclear", label: "No / unclear", points: 0 },
    ],
  },
  {
    id: "reply_speed",
    label: "How quickly do they reply?",
    options: [
      { id: "same_day", label: "Same day", points: 15 },
      { id: "takes_days", label: "Takes days", points: 5 },
      { id: "not_replying", label: "Not replying", points: 0 },
    ],
  },
  {
    id: "fit",
    label: "Fit with Broadway?",
    options: [
      { id: "kg8_homeschooling", label: "KG–8 and wants homeschooling", points: 10 },
      { id: "unsure_online", label: "Right grade, unsure about online", points: 5 },
      { id: "poor_fit", label: "Outside KG–8 / poor fit", points: 0 },
    ],
  },
];

export const MAX_SCORE = SCORE_QUESTIONS.reduce(
  (sum, q) => sum + Math.max(...q.options.map((o) => o.points)),
  0,
); // 100

export const TEMPERATURE_LABEL: Record<Temperature, string> = {
  HOT: "Hot",
  WARM: "Warm",
  COLD: "Cold",
};

// What a counselor should actually do once a lead lands in each bucket —
// shown alongside the computed result so the score is actionable, not just
// a number.
export const TEMPERATURE_GUIDANCE: Record<Temperature, string> = {
  HOT: "Call within 24 hours, push for the application and fee payment, never leave more than 3 days without contact.",
  WARM: "Book or follow up the demo class, answer fee and curriculum doubts, follow up every 3–5 days.",
  COLD: "Add to the parent newsletter and WhatsApp updates, check back monthly or before the next term starts.",
};

export function temperatureFromPoints(points: number): Temperature {
  if (points >= 70) return "HOT";
  if (points >= 40) return "WARM";
  return "COLD";
}

// `answers` is question id -> answer id. Unanswered questions score 0 —
// a counselor can score a lead from a partial call and refine it later.
export function scoreLead(answers: Record<string, string>): { points: number; temperature: Temperature } {
  const points = SCORE_QUESTIONS.reduce((sum, q) => {
    const chosen = answers[q.id];
    const option = q.options.find((o) => o.id === chosen);
    return sum + (option?.points ?? 0);
  }, 0);
  return { points, temperature: temperatureFromPoints(points) };
}
