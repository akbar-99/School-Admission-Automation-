// Domain types mirroring the database schema (supabase/migrations).
// The Supabase clients are used untyped; query results are cast to these.

export type UserRole =
  | "marketing"
  | "parent"
  | "teacher"
  | "admin"
  | "class_teacher";

export type AppStatus =
  | "LEAD_CREATED"
  | "FORM_SUBMITTED"
  | "ASSESSMENT_SCHEDULED"
  | "ASSESSMENT_COMPLETED"
  | "AGREEMENT_SENT"
  | "PAYMENT_PENDING"
  | "PAYMENT_COMPLETED"
  | "PAYMENT_FAILED"
  | "ABANDONED"
  | "ENROLLED"
  | "NEEDS_ADMIN"
  | "REJECTED";

export type Category = "KG" | "GRADE";
export type Gender = "male" | "female" | "other";
export type AssessmentOutcome = "PASS" | "FAIL";
export type PaymentState =
  | "created"
  | "pending"
  | "completed"
  | "failed"
  | "abandoned";
export type NotificationChannel = "email" | "sms" | "whatsapp";
export type NotificationStatus = "queued" | "sent" | "failed";

export interface AppUser {
  id: string;
  role: UserRole;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  // Zoom account email used to host this teacher's assessment meetings.
  zoom_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface Parent {
  id: string;
  full_name: string;
  email: string | null;
  phone: string;
  created_at: string;
  updated_at: string;
}

export interface Student {
  id: string;
  parent_id: string;
  full_name: string;
  dob: string;
  gender: Gender | null;
  previous_school: string | null;
  curriculum: string | null;
  country_of_residence: string | null;
  current_address: string | null;
  permanent_address: string | null;
  father_name: string | null;
  father_phone: string | null;
  mother_name: string | null;
  mother_phone: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentRef {
  category: string; // e.g. "passport", "birth_certificate"
  type: string; // MIME type
  path: string;
  name: string;
  size: number;
}

export interface Application {
  id: string;
  parent_id: string;
  student_id: string | null;
  status: AppStatus;
  category: Category | null;
  grade_applying: string | null;
  lead_student_name: string | null;
  preferred_assessment_date: string | null;
  preferred_assessment_date_alt: string | null;
  preferred_assessment_tz: string | null;
  documents: DocumentRef[];
  consent_accepted: boolean;
  consent_at: string | null;
  agreement_accepted: boolean;
  agreement_accepted_at: string | null;
  agreement_signature: string | null;
  agreement_ip: string | null;
  section_id: string | null;
  admission_number: string | null;
  access_token: string;
  token_expires_at: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Section {
  id: string;
  grade: string;
  name: string;
  capacity: number;
  filled: number;
  created_at: string;
  updated_at: string;
}

export interface AssessmentSlot {
  id: string;
  teacher_id: string;
  starts_at: string;
  ends_at: string;
  is_open: boolean;
  application_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubjectResult {
  subject: string;
  score: number | null;
  maxScore: number | null; // out-of value, e.g. 100, 50, 10
  comment: string | null;
  file: DocumentRef | null; // uploaded PDF / Excel for this subject
}

export interface AssessmentResult {
  id: string;
  application_id: string;
  slot_id: string | null;
  teacher_id: string | null;
  outcome: AssessmentOutcome;
  remarks: string | null;
  subjects: SubjectResult[];
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  application_id: string;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  razorpay_signature: string | null;
  amount: number;
  currency: string;
  status: PaymentState;
  receipt: string | null;
  notes: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationRow {
  id: string;
  application_id: string | null;
  event: string;
  channel: NotificationChannel;
  recipient: string;
  subject: string | null;
  body: string | null;
  payload: Record<string, unknown> | null;
  status: NotificationStatus;
  error: string | null;
  created_at: string;
}

// Human-friendly labels + badge tones for statuses.
export const STATUS_LABEL: Record<AppStatus, string> = {
  LEAD_CREATED: "Lead created",
  FORM_SUBMITTED: "Form submitted",
  ASSESSMENT_SCHEDULED: "Assessment scheduled",
  ASSESSMENT_COMPLETED: "Assessment completed",
  AGREEMENT_SENT: "Agreement sent",
  PAYMENT_PENDING: "Payment pending",
  PAYMENT_COMPLETED: "Payment completed",
  PAYMENT_FAILED: "Payment failed",
  ABANDONED: "Payment abandoned",
  ENROLLED: "Enrolled",
  NEEDS_ADMIN: "Needs admin",
  REJECTED: "Rejected",
};

export type BadgeTone = "neutral" | "info" | "warning" | "success" | "danger";

export const STATUS_TONE: Record<AppStatus, BadgeTone> = {
  LEAD_CREATED: "neutral",
  FORM_SUBMITTED: "info",
  ASSESSMENT_SCHEDULED: "info",
  ASSESSMENT_COMPLETED: "info",
  AGREEMENT_SENT: "warning",
  PAYMENT_PENDING: "warning",
  PAYMENT_COMPLETED: "success",
  PAYMENT_FAILED: "danger",
  ABANDONED: "danger",
  ENROLLED: "success",
  NEEDS_ADMIN: "danger",
  REJECTED: "danger",
};
