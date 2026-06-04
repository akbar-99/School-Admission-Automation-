# Online School Admission Automation System

Automates the full admission lifecycle — lead → application → category detection →
assessment → agreement → Razorpay payment → enrollment → onboarding — per the SRS
in [`docs/SRS.md`](docs/SRS.md).

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · Supabase
(Postgres + Auth + Storage, RLS) · Razorpay · pluggable NotificationService.

---

## Quick start

```bash
npm install
npm run dev            # http://localhost:3000 (or next free port)
```

The Supabase schema for project `cqvjnblrevscoxhbnifo` is already applied
(`supabase/migrations/`). To (re)seed the demo staff accounts:

```
GET /api/setup?secret=<SETUP_SECRET>     # SETUP_SECRET is in .env.local
```

### Demo staff logins (`/login`)

| Role          | Email                          | Password        |
| ------------- | ------------------------------ | --------------- |
| Admin         | `admin@admission.local`        | `Admin@12345`   |
| Marketing     | `marketing@admission.local`    | `Market@12345`  |
| Teacher       | `teacher@admission.local`      | `Teacher@12345` |
| Class teacher | `classteacher@admission.local` | `Class@12345`   |

Parents do **not** log in — they use the secure admission link (`/apply/<token>`).

---

## End-to-end demo

1. **Marketing** (`/marketing`) → create a lead → copy the admission link.
2. **Parent** opens the link → fills the form. Category (KG/Grade) is auto-detected
   from age at the cutoff (config `age_cutoff_mmdd`, default 1 June).
   - **KG** → straight to agreement + payment.
   - **Grade** → assessment required.
3. **Teacher** (`/teacher`) → open a slot. Parent books it (atomic, no double-booking).
   Teacher records Pass/Fail.
   - **Pass** → agreement + payment link sent. **Fail** → application rejected.
4. **Parent** pays the admission fee. Without Razorpay keys a **simulated** payment
   is used; with keys, real Razorpay checkout + signature-verified webhook.
5. On payment, the system atomically generates the **admission number**
   (`YEAR-GRADE-NNN`) and allocates the first section with space (A→B→C…). If full →
   `NEEDS_ADMIN` for the admin to resolve in `/admin`.
6. **Parent** sees the onboarding pack (admission no., section, study material,
   calendar, contacts, receipt).
7. **Admin** (`/admin`) monitors everything; `/admin/sections` manages capacity;
   `/admin/notifications` shows every message + the audit log.

---

## Configuration (`.env.local`)

| Group | Keys |
| ----- | ---- |
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| App | `NEXT_PUBLIC_APP_URL`, `APP_SECRET`, `SETUP_SECRET` |
| Admission rules | `ADMISSION_YEAR`, `AGE_CUTOFF_MMDD`, `KG_MIN_AGE`, `KG_MAX_AGE`, `GRADE_MIN_AGE`, `DEFAULT_SECTION_CAPACITY`, `ADMISSION_FEE_PAISE`, `DATA_RETENTION_DAYS` |
| Razorpay | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `NEXT_PUBLIC_RAZORPAY_KEY_ID` |
| Notifications | `NOTIFY_PROVIDER` (`log`\|`live`), `RESEND_API_KEY`, `MSG91_AUTH_KEY`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` |

Age bands, cutoff date, capacity and fee are **configuration, not hard-coded**
(SRS FR-7), mirrored in the `app_config` table.

### Going live with payments
Set the four Razorpay keys, then add a webhook in the Razorpay dashboard pointing
to `/api/razorpay/webhook` (events `payment.captured`, `payment.failed`) using
`RAZORPAY_WEBHOOK_SECRET`. Payment is credited **only** from the verified webhook /
verify route — never the browser (SRS FR-20).

### Going live with notifications
Set `NOTIFY_PROVIDER=live` and the relevant provider keys. All providers sit behind
one `NotificationService` interface (`src/lib/notifications.ts`); dev uses a log
provider that records every message in the `notifications` table.

---

## Architecture

```
src/
  app/
    page.tsx                     Landing
    login/                       Staff auth (Supabase Auth)
    marketing/                   Lead entry + status tracking
    apply/[token]/               Parent portal (status-driven steps)
    teacher/                     Slots + assessment results
    admin/                       Overview, sections, notifications & audit
    api/
      razorpay/{order,verify,webhook}/   Server-side payments (FR-17..20)
      agreement/[token]/         Printable admission agreement (FR-16)
      setup/                     One-time demo-staff seeding
  lib/
    supabase/{client,server,admin}.ts    Browser / session / service-role clients
    workflow.ts                  Lifecycle orchestration + notifications (N-1..N-10)
    payments.ts                  Order creation + webhook-driven completion
    age.ts                       Age -> KG/Grade detection (FR-7)
    notifications.ts             NotificationService (log + live providers)
    razorpay.ts, auth.ts, audit.ts, config.ts, parent.ts, types.ts
  proxy.ts                       Next 16 "proxy" (middleware): session refresh + guard
supabase/migrations/             0001 schema · 0002 functions · 0003 RLS · 0004 seed
```

### Why it's correct under concurrency (SRS FR-13, FR-21, FR-22)
Three `SECURITY DEFINER` Postgres functions do the critical work atomically:
- `next_admission_number(year, grade)` — `INSERT … ON CONFLICT DO UPDATE … RETURNING`,
  never duplicates under load.
- `book_assessment_slot(slot, app)` — conditional update on an open slot; the loser
  gets `SLOT_UNAVAILABLE`. A partial unique index stops an app booking two slots.
- `enroll_application(app, year)` — `SELECT … FOR UPDATE SKIP LOCKED` picks the first
  section with space, bumps `filled`, mints the admission number, all in one
  transaction; falls back to `NEEDS_ADMIN` when every section is full.

A `BEFORE UPDATE` trigger enforces the §2.3 state machine and rejects invalid
transitions (verified: `LEAD_CREATED → ENROLLED` is blocked).

### Security
- RLS enabled on every table; the anon key can read nothing by default.
- Privileged writes use the service-role key only in server code, after an explicit
  role gate (`requireRole`) or a validated parent token.
- Documents are stored in a **private** Supabase Storage bucket.
- Razorpay/webhook secrets and the service-role key are server-only env vars.

---

## Scripts
- `npm run dev` — dev server
- `npm run build` — production build
- `npm start` — run the production build
