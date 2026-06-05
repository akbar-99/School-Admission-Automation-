# Admission — Step-by-Step Walkthrough
## Following ONE admission from start to finish

Portal: https://school-admission-automation-beta.vercel.app
Each step says **WHO** acts and **WHAT** they do. Follow them in order.

---

## STEP 1 — Marketing creates the lead 🧑‍💼
**Who:** Marketing Team · **Where:** `/marketing`

1. Sign in at `/login`.
2. On the **Leads** page, fill the **New lead** form:
   - Parent name *(required)*
   - Phone number *(required)*
   - Email *(recommended — the link is emailed here)*
   - Student name *(optional)*
3. Click **Create lead & send link**.

➡️ The system **automatically emails the parent their private admission link**
and shows it with a **Copy link** button (you can also share it on WhatsApp).
Status becomes **Lead created**.

---

## STEP 2 — Parent fills the admission form 👨‍👩‍👦
**Who:** Parent · **Where:** their link (`/apply/…`) — **no login**

1. Parent opens the link from the email/message.
2. Fills the **Admission form**:
   - Student name, **date of birth**, gender, **grade**, previous school.
   - Uploads documents (birth certificate, report card, ID) — PDF/JPG/PNG, max 5 MB.
   - Ticks the **data-consent** box (required).
3. Clicks **Submit application**.

➡️ As they enter the date of birth, the page previews **KG or Grade**.
Status becomes **Form submitted**.

---

## STEP 3 — System detects the category automatically 🤖
**Who:** System (no one clicks anything)

Based on the child's age as of **1 June 2026**:
- **3–5 years → KG** → **skip to STEP 7** (straight to the agreement).
- **6 years and above → Grade** → continue to **STEP 4** (assessment required).

➡️ Parent gets a "we received your application" email. For **Grade**, the
**assessment teachers are notified**; for **KG**, the **admin** is notified.

---

## STEP 4 — Assessment (GRADE applicants only) 📝

### 4a — Teacher opens time slots 👩‍🏫
**Who:** Assessment Teacher · **Where:** `/teacher`
1. Sign in → pick a **start time** and **duration** (default 30 min).
2. Open the slot.
➡️ All waiting Grade parents are **emailed that slots are available**.

### 4b — Parent books a slot 👨‍👩‍👦
**Who:** Parent · **Where:** their link
1. Refresh the link → a **slot picker** now appears.
2. Pick a time → **Book**.
➡️ Booking is instant; a slot can't be double-booked. Parent, Teacher and Admin
are notified. Status becomes **Assessment scheduled**.

### 4c — Teacher records the result 👩‍🏫
**Who:** Assessment Teacher · **Where:** `/teacher`
1. After the assessment, find the applicant.
2. Choose **Pass** or **Fail**, add remarks (optional) → Submit.

➡️ Result is emailed to the parent and admin.
- **PASS** → continue to **STEP 5**.
- **FAIL** → status **Rejected**, parent gets a courteous note, **journey ends here.**

---

## STEP 5 — Agreement + payment link is sent 📄
**Who:** System (automatic, for KG and Grade-Pass)

➡️ The parent is emailed the **admission agreement** and the **payment link**.
Status becomes **Agreement sent**.

---

## STEP 6 — Parent reviews & pays 💳
**Who:** Parent · **Where:** their link

1. Open the link → **View / print the admission agreement (PDF)**.
2. Click to **pay the admission fee (₹50,000)** online.
3. Complete payment in the gateway.

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
**Exception:** if *every* section for that grade is full → status **Needs admin**
and an admin is notified (see STEP 9).

---

## STEP 8 — Welcome & onboarding 🎉
**Who:** System (automatic)

➡️ The parent gets a **welcome email** with their admission number, class &
section, a **payment receipt**, and the **onboarding pack** (study material list,
academic calendar, contacts). The assigned **Class Teacher is notified** of the
new student. **Admission complete.**

---

## STEP 9 — Admin steps in only when needed 🛠️
**Who:** Admin · **Where:** `/admin`

- **"Needs admin" (no seat):** go to **Sections**, add capacity (**+5 seats**) or
  a new section, then re-run enrollment for that application → it enrols and the
  welcome pack goes out.
- **Manage sections/capacity:** `/admin/sections`.
- **Add staff** (marketing/teacher/admin): `/admin/staff` → invite by email.
- **Check what was sent:** `/admin/notifications`.

---

## At a glance

```
Marketing: create lead ─► Parent: fill form ─► System: KG or Grade?
   ├─ KG ───────────────────────────────────────────────┐
   └─ Grade ─► Teacher: open slots ─► Parent: book slot ─► Teacher: result
                                                 ├─ Fail ─► REJECTED (end)
                                                 └─ Pass ─┤
                                                          ▼
                         System: send Agreement + payment link
                                          ▼
                         Parent: pay fee  ─► System: admission no. + section
                                          ▼
                         System: welcome + onboarding  (+ Admin if no seat)
```

---

## Who needs to be ready before the first real admission

1. **Admin** signs in and confirms **sections & capacity** exist for each grade.
2. **Admin** invites the **Marketing** and **Teacher** staff (Staff tab).
3. **Assessment Teachers** open some **slots** so Grade applicants can book.
4. **Marketing** starts creating **leads**.
