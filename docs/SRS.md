# SOFTWARE REQUIREMENT SPECIFICATION (SRS) — v2.0
## Online School Admission Automation System

**Document status:** Revised. Razorpay confirmed as payment gateway. Previously missing sections completed (notification triggers, tech stack, age-cutoff logic, concurrency rules, payment security, assessment-fail path, data-protection compliance, application state machine, audit logging).

**Items to fill before build** are marked `[LIKE THIS]`.

---

## 1. INTRODUCTION

### 1.1 Purpose
This document defines the functional and non-functional requirements for the Online School Admission Automation System. The system automates the complete admission lifecycle from lead entry to final enrollment and onboarding.

### 1.2 Scope
The system will:
- Manage admission leads
- Collect student details through an online form
- Auto-detect KG or Grade category based on age
- Handle assessment scheduling (Grade applicants only)
- Generate admission agreements
- Integrate the Razorpay payment gateway
- Auto-generate admission numbers
- Allocate class and section based on seat availability
- Send automated notifications across the lifecycle
- Provide onboarding materials

---

## 2. SYSTEM OVERVIEW

### 2.1 Technology Stack
| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui |
| Backend / DB | Supabase (PostgreSQL), Supabase Auth, Supabase Storage |
| Access control | Row-Level Security (RLS) policies per role |
| Payments | **Razorpay** — server-side order creation + signature-verified webhook |
| Email | Resend (or `[PREFERRED EMAIL PROVIDER]`) |
| SMS | MSG91 (or `[PREFERRED SMS PROVIDER]`) |
| WhatsApp | WhatsApp Cloud API (or `[PREFERRED WHATSAPP PROVIDER]`) |
| Hosting | Vercel (app) + Supabase (data) |

All notification providers sit behind a single `NotificationService` interface so they can be swapped; development uses mock/log providers. All secrets live in environment variables — none are hard-coded.

### 2.2 User Roles
1. **Marketing Team** — enter parent lead details; track lead status.
2. **Parent** — fill admission form; select assessment slot (Grade); make payment; receive onboarding details.
3. **Assessment Teacher** — view Grade applicants; open available time slots; conduct assessment; upload result.
4. **Admin Team** — monitor applications; approve assessment results; view payment status; manage seat allocation.
5. **Class Teacher** — receive notification when a student is assigned to their class.

### 2.3 Application State Machine
The system enforces the following status flow. Invalid transitions are rejected.

```
LEAD_CREATED
   → FORM_SUBMITTED
        → (KG)    AGREEMENT_SENT
        → (GRADE) ASSESSMENT_SCHEDULED → ASSESSMENT_COMPLETED
                     → (PASS) AGREEMENT_SENT
                     → (FAIL) REJECTED        [parent notified, workflow ends]
AGREEMENT_SENT → PAYMENT_PENDING → PAYMENT_COMPLETED → ENROLLED
                                 → PAYMENT_FAILED / ABANDONED [retry allowed]
ENROLLED → (if no seat) NEEDS_ADMIN  [admin manually resolves]
```

---

## 3. FUNCTIONAL REQUIREMENTS

### 3.1 Lead Management Module
- **FR-1** — Marketing Team can enter: Parent Name, Phone Number, Email ID, Student Name (optional).
- **FR-2** — System generates a unique, secure, expirable admission link (signed token).
- **FR-3** — System sends the admission link via WhatsApp, SMS, and Email.
- **FR-3a** — Marketing Team can view the current status of every lead.

### 3.2 Admission Form Module
- **FR-4** — Parent submits: Student Name, Date of Birth, Gender, Previous School, Grade Applying, Parent Details, Uploaded Documents.
- **FR-4a** — Documents accepted as PDF/JPG/PNG, max 5 MB each, stored in Supabase Storage. A consent checkbox is required before upload (DPDP — see 4.2).
- **FR-5** — System validates all mandatory fields server-side.
- **FR-6** — System calculates student age automatically.

### 3.3 Category Detection Engine
- **FR-7** — System auto-detects category based on age **as of a configurable cutoff date** `[e.g. 1 June of admission year]`:
  - 3–5 years → KG
  - 6+ years → Grade

  The cutoff date and age bands are configuration values, not hard-coded.
- **FR-8** — System routes the workflow based on detected category.

### 3.4 Assessment Scheduling Module (Grade Only)
- **FR-9** — On Grade application submission, system notifies assessment teachers.
- **FR-10** — Teachers log in and open available time slots.
- **FR-11** — System publishes available slots to the parent.
- **FR-12** — Parent selects one available slot.
- **FR-13** — On selection, the booking is **atomic** (DB transaction + unique constraint) so a slot cannot be double-booked. System then: blocks the slot, notifies the teacher, notifies admin, sends confirmation to parent.
- **FR-14** — Teacher uploads assessment result (Pass / Fail + Remarks).
- **FR-15** — System sends the result to the parent and notifies admin.
- **FR-15a** — On a **FAIL** result, the application moves to `REJECTED`, the parent receives a courteous notification, and the workflow ends (no agreement is generated).

### 3.5 Agreement & Payment Module (KG + Grade-Pass)
- **FR-16** — System auto-generates an Admission Agreement (PDF) pre-filled with parent and student details.
- **FR-17** — System creates a Razorpay order **server-side** and generates a secure payment link.
- **FR-18** — System sends the agreement and Razorpay payment link to the parent.
- **FR-19** — System integrates with the Razorpay payment gateway (Orders API for creation, Webhooks for confirmation).
- **FR-20** — Payment status is updated **only** from a Razorpay webhook whose signature has been verified server-side using the webhook secret. The client/browser is never trusted to confirm payment.
- **FR-20a** — Failed, abandoned, or cancelled payments are handled gracefully; the parent can retry from `PAYMENT_PENDING`.
- **FR-20b** — A payment receipt is issued to the parent on success.

### 3.6 Enrollment Automation Module
- **FR-21** — System auto-generates the Admission Number in format `YEAR-GRADE-RUNNINGNUMBER` (e.g. `2026-G1-045`). Generation is **atomic** — a PostgreSQL sequence or row-locked counter per `(year, grade)` — so numbers are never duplicated under concurrency.
- **FR-22** — System allocates a class division based on seat availability:
  - Each section has a configurable maximum capacity.
  - Assign to the first section with space (A → B → C …).
  - If all sections are full, set status to `NEEDS_ADMIN` and notify admin.
  - Allocation runs inside a transaction to prevent over-filling under concurrent enrollments.

### 3.7 Notification Module
System sends automated notifications on the following events (each routed via the relevant channel — WhatsApp / SMS / Email):

| # | Event | Recipient(s) |
|---|---|---|
| N-1 | Lead created | Parent (admission link) |
| N-2 | Form submitted | Parent (confirmation); Teachers (Grade) or Admin (KG) |
| N-3 | Assessment slots published | Parent |
| N-4 | Slot booked | Parent (confirmation), Teacher, Admin |
| N-5 | Assessment result uploaded | Parent (result), Admin |
| N-6 | Agreement + Razorpay payment link ready | Parent |
| N-7 | Payment successful | Parent (receipt), Admin |
| N-8 | Student enrolled | Parent (admission no. + welcome + onboarding pack), assigned Class Teacher |
| N-9 | All sections full | Admin |
| N-10 | Assessment failed | Parent |

### 3.8 Onboarding Module
- **FR-23** — System sends a Welcome Message automatically after enrollment.
- **FR-24** — System shares: Study Material List, Academic Calendar, Contact Person Details, Parent Portal Login (if applicable).

---

## 4. NON-FUNCTIONAL REQUIREMENTS

### 4.1 Performance
- Support a minimum of 500 concurrent users.
- Form submission response time < 3 seconds.

### 4.2 Security & Compliance
- SSL/TLS encryption end-to-end.
- Role-based access control enforced via Supabase RLS.
- Razorpay integration with server-side order creation and signature-verified webhooks; Razorpay keys stored only as server-side environment variables.
- **DPDP Act, 2023 (India)** considerations: explicit consent at document upload, data minimisation, defined retention period, and access controls. `[CONFIRM RETENTION POLICY]`
- All user input validated and sanitised server-side.

### 4.3 Availability
- 99% uptime target.
- Cloud-hosted (Vercel + Supabase).

### 4.4 Scalability
- Supports multiple grades, multiple sections, and (future) multiple campuses.

---

## 5. DATABASE REQUIREMENTS

Main tables, with foreign keys, the status enum from §2.3, and timestamps on every row:

- `users`
- `parents`
- `students`
- `applications`
- `assessment_slots`
- `assessment_results`
- `payments` (includes Razorpay `order_id`, `payment_id`, `signature`, status)
- `admission_numbers`
- `sections` (includes `capacity`)
- `notifications`
- `audit_logs` — records who changed what and when (added for accountability and DPDP traceability)

RLS policies are defined per role on every table.

---

## 6. SYSTEM WORKFLOW SUMMARY
1. Lead Entry
2. Admission Form Submission
3. Category Detection (KG / Grade, by age at cutoff date)
4. Assessment (Grade only) → Pass continues; Fail → Rejected
5. Agreement Generation
6. Razorpay Payment (webhook-confirmed)
7. Admission Number Generation (atomic)
8. Section Allocation (capacity-based, transactional)
9. Welcome & Study Material Sharing

---

## 7. FUTURE ENHANCEMENTS (Optional)
- AI chat support for parents
- Automatic fee reminders
- LMS integration
- Mobile app
- Analytics dashboard
- Multi-language support

---

## 8. CONCLUSION
This system automates 90–95% of manual admission work and reduces dependency on staff follow-ups, delivering faster processing, better tracking, reduced human error, and a professional parent experience.