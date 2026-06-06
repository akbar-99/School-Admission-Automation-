# Admission — Step-by-Step Walkthrough
## Following ONE admission from start to finish

Portal: https://school-admission-automation-beta.vercel.app
Each step says **WHO** acts and **WHAT** they do. Follow them in order.
Anything in **Settings** (fee, agreement wording, school name/phone/email, academic
dates, onboarding list) can be changed by an Admin at any time — see STEP 10.

---

## STEP 1 — Marketing creates the lead 🧑‍💼
**Who:** Marketing Team · **Where:** `/marketing`

1. Sign in at `/login`.
2. On the **Leads** page, fill the **New lead** form:
   - Parent name *(required)*
   - Phone number *(required)*
   - Email *(recommended — the secure link is emailed here)*
   - Student name *(optional)*
3. Click **Create lead & send link**.

➡️ The system **automatically emails the parent their private admission link** and
shows it with a **Copy link** button (you can also share it on WhatsApp). Status
becomes **Lead created**.

> 💡 Marketing can also check live seat availability at **`/marketing/seats`** before
> promising a grade to a family.

---

## STEP 2 — Parent fills the admission form 👨‍👩‍👦
**Who:** Parent · **Where:** their link (`/apply/…`) — **no login**

1. Parent opens the link from the email/message.
2. Fills the **Admission form**:
   - **Student:** full name, **date of birth**, gender, **grade applying**, previous
     school, **curriculum**, **country of residence**, **current address**, and
     **permanent address**.
   - **Parents:** father's name & phone, mother's name & phone.
   - **Documents:** birth certificate, report card / previous marks, photo/ID, and
     **passport** — *passport is required only when the country of residence is not
     India* (most families are outside India). PDF/JPG/PNG, max 5 MB each.
   - **Preferred assessment date & time** *(Grade applicants only — not shown for KG)*:
     the page **auto-detects the parent's timezone** and shows a live
     **"Your time / School time (IST)"** preview so there's no confusion across
     countries. They can also give an **alternate** date/time.
   - Ticks the **data-consent** box *(required)*.
3. Clicks **Submit application**.

➡️ As they enter the date of birth, the page previews **KG or Grade**. Status becomes
**Form submitted**, and the parent gets a "we received your application" email.

---

## STEP 3 — System detects the category automatically 🤖
**Who:** System (no one clicks anything)

Based on the child's age as of **1 June 2026**:
- **3–5 years → KG** → **skip to STEP 6** (straight to the agreement).
- **6 years and above → Grade** → continue to **STEP 4** (assessment required).

➡️ For **Grade**, the **Admin** is notified to schedule an assessment; for **KG**, the
Admin is notified that an application is ready for the agreement.
**Note:** all scheduling and admin alerts now go to the **Admin**, not to teachers.

---

## STEP 4 — Admin schedules the assessment (GRADE only) 🛠️
**Who:** Admin · **Where:** `/admin/assessments`

The Admin owns scheduling. There are **two ways** to do it — pick whichever suits:

### Option A — Schedule directly (recommended)
1. Under **Assessment requests**, find the applicant. Their **requested date/time** is
   shown in **school time (IST)** and, if different, the **parent's own timezone**.
2. **Click the "Requested: …" time** — it **auto-fills** the **Confirmed time** field
   (an **Alt: …** button appears too if the parent gave an alternate). You can still
   adjust it.
3. Choose the **teacher**, set the **duration**, and click **Schedule directly**.
➡️ The parent simply gets a **confirmation** for that time; the assigned teacher and
admin are notified. Status becomes **Assessment scheduled**.

### Option B — Publish open slots for parents to book
1. Use **Create & assign a slot**: pick a **start time**, **duration**, and a
   **teacher**, then **Create slot**.
➡️ All waiting Grade parents are **emailed that slots are open**. The parent refreshes
their link, sees a **slot picker**, and **books** a time (can't be double-booked).
Parent, teacher and admin are notified.

> 📋 The Admin can review everything under **Scheduled assessments** and **All slots**
> on the same page.

### STEP 4c — Teacher records the result 👩‍🏫
**Who:** Assessment Teacher · **Where:** `/teacher` *(view-only dashboard)*
1. The teacher sees their **assigned/upcoming slots** (they do **not** create slots).
2. After the assessment, find the applicant, choose **Pass** or **Fail**, add remarks
   (optional) → **Submit**.

➡️ The result is emailed to the **parent and admin**.
- **PASS** → continue to **STEP 5**.
- **FAIL** → status **Rejected**, parent gets a courteous note, **journey ends here.**

---

## STEP 5 — Agreement + payment link is sent 📄
**Who:** System (automatic, for KG and Grade-Pass)

➡️ The parent is emailed the **admission agreement** and the **payment link**. Status
becomes **Agreement sent**.

---

## STEP 6 — Parent e-signs the agreement & pays 💳
**Who:** Parent · **Where:** their link

1. Open the link → **read the admission agreement** (auto-filled with the student's and
   parents' details; printable / save-as-PDF).
2. **Digitally accept it:** type their **full name as a signature**. The signature
   **must match the parent's name on file**, and acceptance is **mandatory before
   payment** (date, name and IP are recorded).
3. Click to **pay the admission fee** (amount is set in Settings) online.
4. Complete payment in the gateway.

➡️ Payment is **confirmed by the gateway**, not the browser.
- Success → continue to **STEP 7**.
- Failed / cancelled → parent simply **retries from the same link** (no new lead).

---

## STEP 7 — System enrols the student 🎓
**Who:** System (automatic)

On confirmed payment the system instantly:
1. Generates the **admission number** (e.g. `2026-G1-045`).
2. Assigns the **class section** — first one with space (A → B → C …).

➡️ Status becomes **Enrolled**.
**Exception:** if *every* section for that grade is full → status **Needs admin** and an
admin is notified (see STEP 9).

---

## STEP 8 — Welcome & onboarding 🎉
**Who:** System (automatic)

➡️ The parent gets a **welcome email** with their admission number, class & section, a
**payment receipt**, and the **onboarding pack** (study-material list, academic
calendar, and clickable phone/email — all editable in Settings). The assigned **Class
Teacher is notified** of the new student. **Admission complete.**

---

## STEP 9 — Admin tools & oversight 🛠️
**Who:** Admin · **Where:** `/admin`

- **Overview dashboard (`/admin`):** four summary cards, **analytics charts** (an
  application-status **donut** and a 12-month **admissions growth** bar chart), and the
  full applications table.
- **Applicant detail page:** click any **student name** in the table to open their full
  record — all details, **download each uploaded document** (secure, time-limited
  links), and **Print / export to PDF**. Includes a **Delete applicant** action (type
  `DELETE` to confirm) that removes that one applicant and frees their seat.
- **"Needs admin" (no seat):** go to **Sections**, add capacity (**+5 seats**) or a new
  section, then allocate the seat for that application → it enrols and the welcome pack
  goes out.
- **Sections (`/admin/sections`):** manage grades, sections and capacity.
- **Staff (`/admin/staff`):** invite marketing/teacher/admin by email — they receive a
  link to **set their own password**.
- **Notifications (`/admin/notifications`):** a log of **every message sent** (channel +
  delivered/failed status).

---

## STEP 10 — Settings the Admin can change anytime ⚙️
**Who:** Admin · **Where:** `/admin/settings` — *changes apply immediately, no redeploy*

- **Admission fee (₹)** — used for new payment orders.
- **Agreement terms** — the wording shown on the admission agreement.
- **School name, phone, email** — phone & email are clickable on the agreement/onboarding.
- **Academic dates** — term start and orientation day.
- **Onboarding study-material list** — one item per line.
- **Danger zone — Factory reset:** type `RESET` to **wipe all applicant data** (leads,
  applications, students, parents, payments, assessments, notifications) and reset seat
  counts and admission numbers. **Staff logins, sections, and these settings are kept.**

---

## At a glance

```
Marketing: create lead ─► Parent: fill form (+ preferred assessment time)
                                   ▼
                         System: KG or Grade?
   ├─ KG ───────────────────────────────────────────────────────────┐
   └─ Grade ─► Admin: schedule (direct) OR publish slots ─► assessment │
                              ▼                                        │
                     Teacher: record result                           │
                              ├─ Fail ─► REJECTED (end)                │
                              └─ Pass ─┤                               │
                                       ▼                               ▼
                         System: send Agreement + payment link  ◄──────┘
                                       ▼
                    Parent: e-sign agreement ─► pay fee
                                       ▼
                    System: admission no. + section  (+ Admin if no seat)
                                       ▼
                    System: welcome + onboarding  ─►  ENROLLED ✅
```

---

## Who needs to be ready before the first real admission

1. **Admin** signs in and confirms **sections & capacity** exist for each grade.
2. **Admin** reviews **Settings** (fee, agreement wording, school contacts, onboarding).
3. **Admin** invites the **Marketing** and **Teacher** staff (Staff tab).
4. **Marketing** starts creating **leads** — and the flow above takes over.
