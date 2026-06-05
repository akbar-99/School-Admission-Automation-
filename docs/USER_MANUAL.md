# Broadway Home Schooling — Admissions Portal
## Team User Manual

**Audience:** Marketing, Assessment Teachers, Admin, and Class Teachers.
**Portal:** https://school-admission-automation-beta.vercel.app

---

## 1. What this system does

The Admissions Portal automates the whole admission journey — from the moment a
parent shows interest to the day the child is enrolled and onboarded. It handles
the admission form, decides KG vs Grade automatically from the child's age, books
assessments, generates the agreement, takes the fee online, assigns an admission
number and class section, and sends every notification along the way.

**The golden rule:** the system moves an application through a fixed set of
**stages** (statuses). Each action by a team member or parent pushes it to the
next stage. You can always see the current stage of every application.

---

## 2. Who does what (roles)

| Role | What they do | Where they work |
|---|---|---|
| **Marketing** | Enter parent leads, send the admission link, track status, view seat availability | `/marketing` |
| **Parent** | Fill the form, book an assessment slot (Grade only), pay the fee | Their secure link — **no login** |
| **Assessment Teacher** | Open assessment time slots, record Pass/Fail results | `/teacher` |
| **Admin** | Oversee everything, manage class sections & capacity, create staff accounts, resolve seat issues | `/admin` |
| **Class Teacher** | Receive a notification when a new student is assigned to their class | (email) |

> **Parents never log in.** They get a private, secure link by email/SMS/WhatsApp
> and do everything from that one link.

---

## 3. The admission journey (the big picture)

```
1. Marketing creates a LEAD                → parent gets their admission link
2. Parent fills the ADMISSION FORM         → system detects KG or Grade by age
3a. KG          → straight to AGREEMENT
3b. Grade       → ASSESSMENT
        Teacher opens slots → parent books → teacher records result
        PASS → AGREEMENT     |     FAIL → REJECTED (journey ends)
4. AGREEMENT + PAYMENT LINK sent to parent
5. Parent PAYS the admission fee (online)
6. System auto-assigns ADMISSION NUMBER + CLASS SECTION
7. Parent + Class Teacher get WELCOME + ONBOARDING pack
```

At every step the system sends the right message to the right person
automatically (see §9).

---

## 4. Getting access (staff accounts)

### 4.1 Signing in
1. Go to **`/login`**.
2. Enter your **email** and **password**.
3. You'll land on your role's home page automatically.

Parents do **not** use this page — they use their admission link.

### 4.2 Creating new staff (Admin only)
1. Admin → **Staff** tab → **Invite a staff member**.
2. Enter **Full name**, **Email**, and pick a **Role** (Marketing / Assessment
   teacher / Class teacher / Admin).
3. Click **Send invite**. The person receives an email with a link to set their
   own password.
4. They click the link → choose a password → they're in.

> Until someone sets their password from the invite link, they cannot sign in.

---

## 5. Marketing Team — step by step

Your home is **`/marketing`** (the "Leads" tab).

### 5.1 Create a new lead
1. Fill **Parent name** and **Phone number** (required).
2. Add **Email** (strongly recommended — the admission link is emailed here) and
   **Student name** (optional).
3. Click **Create lead & send link**.
4. The system creates the lead and **automatically sends the admission link** to
   the parent (email; SMS/WhatsApp when those channels are enabled).
5. A green banner shows the link with a **Copy link** button — you can share it
   manually too (e.g. paste into WhatsApp).

### 5.2 Track every lead
The **All leads** table shows Parent, Student, Category, **Status**, Created date,
and a Copy-link button for each. Use the Status column to see exactly where each
family is in the journey.

### 5.3 Check seat availability
1. Marketing → **Seat availability** tab.
2. See total open seats, and a breakdown **per grade and section** (e.g.
   "G1 — 12 seats open", "Section A: 18/30").
3. Use this to set expectations with parents before enrolling.

> **Note:** A seat is only consumed when a student is **fully enrolled** (after
> payment). Pending leads/applications do **not** reserve a seat — so a popular
> grade can still fill up. Treat the number as "currently open," not "reserved."

---

## 6. What the Parent experiences (so you can guide them)

The parent opens their link and sees a page that changes as they progress:

1. **Admission form** — student name, date of birth, gender, grade, previous
   school, and document uploads (birth certificate, report card, ID). They must
   tick a **data-consent** box (privacy law requirement) before submitting.
   - Documents: **PDF / JPG / PNG, max 5 MB each**.
   - As they type the date of birth, the page previews **KG or Grade**.
2. **If Grade:** a **slot picker** appears once teachers have opened slots. They
   pick a time; booking is instant and a slot can't be double-booked.
3. **Agreement & payment:** they can **view/print the agreement (PDF)** and **pay
   the admission fee** online.
4. **After payment:** they see their **admission number, class & section**, a
   **welcome message**, the **onboarding pack** (study material list, academic
   calendar, contacts), and a **payment receipt**.

If a link is older than **14 days** it expires and the parent must be issued a
new lead.

---

## 7. Assessment Teacher — step by step (Grade applicants only)

Your home is **`/teacher`**.

### 7.1 Open assessment slots
1. Pick a **start time** and **duration** (default 30 min).
2. Click to open the slot.
3. The system **notifies all waiting Grade applicants** that slots are available,
   so they can book.

### 7.2 Record a result
1. Find the applicant who attended.
2. Choose **Pass** or **Fail** and add **remarks** (optional).
3. Submit.
   - **Pass** → the system advances the application to **Agreement** and emails the
     parent the agreement + payment link.
   - **Fail** → the application is **Rejected**, the parent gets a courteous note,
     and the journey ends (no agreement is generated).

> A result can only be recorded once per applicant, so double-check Pass/Fail
> before submitting.

---

## 8. Admin Team — step by step

Your home is **`/admin`**. You can also do everything Marketing and Teachers can.

### 8.1 Overview
Monitor all applications and their statuses in one place.

### 8.2 Sections & capacity (`/admin/sections`)
- **Add a section**: pick a grade (e.g. `G1`), a section name (e.g. `C`), and a
  capacity.
- **Add capacity**: use **+5 seats** on any section.
- Seats fill **A → B → C** automatically as students enrol.

### 8.3 Staff accounts (`/admin/staff`)
- Invite Marketing, Teachers, Class Teachers, or other Admins (see §4.2).

### 8.4 Notifications log (`/admin/notifications`)
- Review every message the system has sent and its delivery status.

### 8.5 Resolve a "Needs admin" application
If all sections for a grade are full when a paid student is ready to enrol, the
application goes to **Needs admin**:
1. Free up or **add capacity** in Sections.
2. Re-run enrollment for that application from the admin tools.
3. The student then gets an admission number and section, and the welcome pack.

---

## 9. Notifications — who gets what, and when

| Event | Who is notified |
|---|---|
| Lead created | **Parent** (admission link) |
| Form submitted | Parent (confirmation); Teachers (Grade) or Admin (KG) |
| Slots published | Waiting Grade parents |
| Slot booked | Parent, Teacher, Admin |
| Assessment result | Parent (result), Admin |
| Agreement + payment link ready | Parent |
| Payment successful | Parent (receipt), Admin |
| Student enrolled | Parent (admission no. + welcome + onboarding), assigned Class Teacher |
| All sections full | Admin |
| Assessment failed | Parent (courteous note) |

Email is the live channel. SMS and WhatsApp are prepared but only become active
once those providers are connected.

---

## 10. Payments — how it works

- The fee is **₹50,000** (configurable).
- The parent pays online from their link. Payment is **confirmed by the payment
  gateway**, never by the browser — so a payment only counts when the gateway
  verifies it.
- **Retries:** if a payment fails, is cancelled, or abandoned, the parent can
  simply **try again from their link** — no new lead needed.
- On success the parent gets a **receipt**, and enrollment runs automatically.

---

## 11. Admission number & class allocation

- **Admission number** format: `YEAR-GRADE-RUNNINGNUMBER` (e.g. `2026-G1-045`),
  generated automatically and never duplicated.
- **Section** is assigned to the **first section with space (A → B → C …)** for
  that grade.
- If **every** section is full → status **Needs admin** and Admin is notified to
  add capacity (see §8.5).

---

## 12. The status lifecycle (what each stage means)

| Status | Meaning | What moves it forward |
|---|---|---|
| **Lead created** | Link sent, awaiting the form | Parent submits the form |
| **Form submitted** | Form received, category detected | KG → Agreement; Grade → Assessment |
| **Assessment scheduled** | Slot booked | Teacher records result |
| **Assessment completed** | Result recorded | Pass → Agreement; Fail → Rejected |
| **Agreement sent** | Agreement + payment link issued | Parent starts payment |
| **Payment pending** | Awaiting payment confirmation | Gateway confirms / fails |
| **Payment completed** | Fee received | System enrolls the student |
| **Payment failed / Abandoned** | Payment didn't complete | Parent retries |
| **Enrolled** | Admission number + section assigned | — (done) |
| **Needs admin** | Paid, but no seat available | Admin adds capacity & resolves |
| **Rejected** | Assessment failed | — (journey ends) |

The system **rejects invalid jumps** between stages, so the journey always stays
consistent.

---

## 13. Age → category rules (current settings)

- Age is measured **as of 1 June 2026** (the admission-year cutoff).
- **3–5 years → KG**
- **6 years and above → Grade** (requires assessment)
- A child below the minimum age is flagged as not eligible at form time.

These bands and the cutoff are configurable by the school.

---

## 14. Quick troubleshooting (for the team)

| Situation | What to do |
|---|---|
| Parent says the link doesn't work / is expired | Links expire after 14 days — create a new lead for them. |
| Parent didn't receive the email | Confirm the email was entered correctly; ask them to check spam; resend by re-copying the link from the leads table. |
| Grade parent sees "no slots yet" | A teacher must open assessment slots first. |
| Paid parent stuck on "Needs admin" | Admin adds capacity for that grade, then resolves the seat (§8.5). |
| New staff can't sign in | They must set their password from the invite email first. |
| Wrong category detected | Check the child's date of birth on the form; category follows the age cutoff. |

---

## 15. Glossary

- **Lead** — an interested parent entered by Marketing; the start of the journey.
- **Admission link** — the parent's private, secure, time-limited URL.
- **Category** — KG or Grade, decided automatically from age.
- **Assessment** — the evaluation Grade applicants must pass before an agreement.
- **Agreement** — the printable admission agreement PDF, pre-filled with details.
- **Section** — a class division (A, B, C…) with a seat capacity.
- **Onboarding pack** — study material list, academic calendar, and contacts sent
  on enrollment.

---

*For technical/deployment details, see the project README and `docs/SRS.md`.*
