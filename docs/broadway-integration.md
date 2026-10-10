# Admission tracker ↔ Broadway platform

The admission tracker (broadwayadmissiontracker.in) runs admissions and makes the sections (Admin → Sections). The Broadway platform is the school's system for the students, families, timetables and records. The old ERP (Supabase project `lxnwnkgyjywoolnqsrjy`) is no longer used. The tracker now talks to Broadway directly, and every section it saves is sent to Broadway.

## The rule for next year's admissions

A student admitted for **next** academic year cannot go into a class yet, because this year's students are still in it. Broadway keeps them as **incoming**:

- They get an admission number and a family record straight away, and the section they are planned for.
- They are not on class lists, attendance or fees, and a new family's account stays closed.
- At the year-end promotion, this year's students move up first, then incoming students join their planned sections. Their family accounts open and the families are emailed their sign-in details.

A student admitted for the **current** year is enrolled at once.

## Setting up

1. Broadway must be on a public HTTPS address. The tracker cannot reach `localhost`.
2. In Broadway, sign in as Admin and go to **Next year admissions → Connection with the admission tracker → Create a connection key**. The key starts with `bwat_` and is shown once. Broadway keeps only its hash; **Replace the key** or **Disconnect** turns the old one off.
3. In the tracker's environment (Coolify):

   | Variable | Value |
   |---|---|
   | `BROADWAY_API_URL` | `https://<broadway address>/api/integrations` |
   | `BROADWAY_API_KEY` | the `bwat_…` key |

   Remove `ERP_ADMISSIONS_SECRET` and `ERP_CLASS_WEBHOOK_SECRET`.
4. Call Broadway from the tracker's server only. The key must never reach a browser.

## Every call

- Header `Authorization: Bearer <BROADWAY_API_KEY>`; send JSON bodies with `Content-Type: application/json`.
- An error answers `{ "error": "<message>" }` with:
  - `400` when the request is wrong;
  - `401` when the key is unknown or revoked;
  - `403` when the student was not admitted through the tracker;
  - `404` when nothing matches;
  - `409` when the student's state does not allow it (for example, they have already joined);
  - `500` for anything else.
- Academic years are written `2027-28`; `2027-2028` and `2027` are read too. The year starts on 1 April.
- Curriculum is `CBSE` or `Cambridge`.
- Grade may be:
  - `KG 1` (or `KG1`, `LKG`) or `KG 2` (or `KG2`, `UKG`). The school has two KG years, so a bare `KG` is refused;
  - `1`–`8`, `G1`, `STD 1`, `Stage 1`, `Grade 1`, or a Roman numeral.
- KG 1 moves up to KG 2, and KG 2 to STD 1 / Stage 1.
- Dates are `YYYY-MM-DD` or `DD/MM/YYYY`.

## `POST /classes`: send a section when it is saved

Send one section, or `{ "classes": [ … ] }` with up to 200. Send them all once, when connecting.

```json
{ "id": "sec-orchid", "grade": "KG 1", "section": "A", "batch": "ORCHID", "capacity": 8, "erpClassName": "CBSE KG 1-A - ORCHID", "classTiming": "Monday to Friday" }
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | the tracker's own section id. Sending the same id again changes that section |
| `grade` | yes | `KG 1`, `KG 2`, `G1`…`G8` |
| `section` | for grades 1–8 | the division (`A`, `B`…). Optional for KG |
| `batch` | for KG | the KG batch name (`ORCHID`) |
| `erpClassName` | yes | gives the **curriculum**: `STD …` is CBSE and `STAGE …` is Cambridge. A KG name must say `CBSE` or `Cambridge`, such as `CBSE KG 1-A - ORCHID` |
| `curriculum` | no | `CBSE` or `Cambridge`; when sent, it is used instead of the name |
| `capacity` | no | seats. Blank or `null` means no limit |
| `classTiming` | no | the timing as the tracker shows it (`Monday to Friday`, `Monday - Friday, 9:30 AM - 1:55 PM IST`) or a timing id from `GET /classes`. `No timing set` or blank clears it |

The answer has one result for each section sent:

```json
{ "results": [{ "id": "sec-orchid", "ok": true, "classId": "c-cb-KG1-orchid-a", "name": "KG 1 A · ORCHID", "curriculum": "CBSE", "grade": "KG1", "created": true, "warnings": [] }] }
```

- `classId` is the section's id in Broadway. Keep it, and send it with admissions.
- `created: false` means an existing section was changed or linked. A section Broadway already had under the same curriculum, grade, division and batch is linked to the tracker's id, not added twice.
- A failure is `{ "ok": false, "code": 400, "error": "…" }`. Show the error next to the section; this is where the old "Not yet pushed" badge went. Common errors:
  - a KG name without `CBSE` or `Cambridge`;
  - a grade that can't be read;
  - the same section twice.
- `warnings`:
  - a timing Broadway doesn't have, or one that is for other grades, so the timing was not set;
  - more students than seats.
- Once a section has students, a timetable or planned new students, its grade and curriculum can't change (`409`). Add a new section instead.
- In Broadway, a section from the tracker is changed or removed only in the tracker. Its coordinator and class teacher are still chosen in Broadway.

## `POST /classes/remove`: a section was deleted in the tracker

```json
{ "id": "sec-orchid" }
```

- The section is removed from Broadway only while nothing uses it. It returns `409` with the reason when:
  - it has students;
  - new students are planned for it next year;
  - it has a timetable or past records;
  - it is its grade's last section.
- An unknown id returns `404`.
- Delete a section in the tracker only after this call succeeds, or keep the tracker's "Empty before deleting" rule.

## `GET /classes`: sections, seats and next year's numbers

Use this to offer only sections that have room. It replaces the capacity sync.

```json
{
  "academicYear": { "current": "2026-27", "next": "2027-28" },
  "promoted": { "CBSE": false, "Cambridge": false },
  "timings": [{ "id": "tm-1-3-mf", "label": "Monday - Friday, 9:30 AM - 12:55 PM IST", "grades": [1, 2, 3] }],
  "classes": [
    {
      "id": "c-cb-1",
      "name": "STD 1A",
      "curriculum": "CBSE",
      "grade": 1,
      "gradeLabel": "STD 1",
      "section": "A",
      "batch": null,
      "division": "A",
      "timingId": null,
      "timing": null,
      "seats": 25,
      "trackerId": "sec-std1a",
      "thisYear": { "students": 10, "seatsLeft": 15 },
      "nextYear": { "continuing": 10, "joining": 0, "students": 10, "seatsLeft": 15 }
    }
  ],
  "notPlaced": [{ "curriculum": "CBSE", "grade": 2, "students": 3 }]
}
```

- `seats` is set by the school under **Classes** in Broadway. `null` means no limit, and `seatsLeft` is then `null` too.
- `section` is what the school calls the section: the division, or for KG the batch name (with the division if it has one).
- `nextYear.continuing` counts this year's students who will be in the section next year:
  - Before the year-end promotion, it uses the usual plan: the previous grade's section with the same division, or the same KG batch. Students who repeat or leave are only decided at the promotion, so this is a forecast.
  - After the promotion, `promoted.<curriculum>` is `true` and `continuing` is the students already in the section.
- `nextYear.joining` counts the incoming students already placed in the section.
- `nextYear.seatsLeft` is `seats − students`, never below 0. For a next-year application, offer the sections where it is above 0 (or `null`). For a current-year application, use `thisYear.seatsLeft`.
- `notPlaced` counts incoming students who have no section yet. They will take seats in their grade too.

`trackerId` is the tracker's section id for the sections it sent, and `null` for sections made only in Broadway.

## `GET /students`: find a student or an admission

This replaces the roster sync and the ERP search.

| Query | Meaning |
|---|---|
| `id=<application id>` | the student the tracker sent with that `id` |
| `admissionNo=<no>` | by Broadway admission number |
| `q=<text>` | name contains the text, or the exact admission number, or the exact parent email |
| `status=Active,Incoming,Left` | which students (default `Active,Incoming`) |
| `limit`, `offset` | paging: `limit` defaults to 100, at most 500 |

```json
{
  "total": 1,
  "students": [
    {
      "studentId": "stumv2q5qol6bf79d",
      "admissionNo": "1185",
      "name": "Riya Thomas",
      "curriculum": "CBSE",
      "grade": 1,
      "gradeLabel": "STD 1",
      "status": "Incoming",
      "classId": null,
      "className": null,
      "plannedClassId": "c-cb-1",
      "plannedClassName": "STD 1A",
      "joinsYear": "2027-28",
      "applicationId": "APP-2027-0153",
      "parentName": "Joseph Thomas",
      "parentEmail": "joseph.thomas@example.com"
    }
  ]
}
```

`classId` is set for `Active` students and `plannedClassId` for `Incoming` students. `applicationId` is set only for students the tracker sent.

## `POST /admissions`: send an admission at enrolment

Send one admission, or `{ "admissions": [ … ] }` with up to 200.

| Field | Required | Notes |
|---|---|---|
| `id` | yes | the tracker's application id. Sending the same `id` again updates the admission until the student joins, so retries are safe |
| `academicYear` | yes | next year (the student becomes incoming) or the current year (enrolled at once) |
| `studentName`, `curriculum`, `grade` | yes | |
| `parentName`, `parentEmail` | yes | the parent email becomes the parent's sign-in. An existing family with that email gets the child added |
| `classId` | no | the Broadway section: the `classId` returned when the section was sent, or from `GET /classes`. This is preferred |
| `section`, `classTiming` | no | instead of `classId`: the division or KG batch name. Add the timing label when two sections share a name |
| `admissionNo` | no | blank means Broadway gives the next number |
| `dob`, `gender`, `parentPhone`, `country`, `enrolledOn` | no | |
| `fatherName`, `fatherPhone`, `motherName`, `motherPhone`, `address`, `previousSchool`, `pen` | no | the admission register details |

The answer has one result for each admission sent, in the same order:

```json
{
  "results": [
    {
      "id": "APP-2027-0153",
      "ok": true,
      "studentId": "stumv2q5qol6bf79d",
      "admissionNo": "1185",
      "status": "Incoming",
      "updated": false,
      "classId": "c-cb-1",
      "className": "STD 1A",
      "warnings": []
    },
    { "id": "APP-2027-0160", "ok": false, "code": 400, "error": "Grade \"X\" should be KG 1, KG 2 or 1 to 8" }
  ]
}
```

- `status` is `Incoming` for next year and `Active` when the student was enrolled now.
- `warnings` are not failures: the admission was taken in. You may see:
  - **Section not found:** for example `CBSE STD 1 has no section "C". Its sections: A. The admin team will choose the section`. `classId` is then `null`, and a current-year student goes into the grade's first section.
  - **Over the seats:** for example `CBSE STD 1A has 25 seats and 26 students in 2027-28`. Broadway does not turn away a family the tracker has admitted. Check `seatsLeft` before admitting.
- A student who has already joined is not changed. The result then says `updated: false`, with a warning.

## `POST /admissions/section`: change the section

```json
{ "id": "APP-2027-0153", "classId": "c-cb-1" }
```

- You can name the student by `id` (application id), `studentId` or `admissionNo`. Instead of `classId`, you can send `section` (plus `classTiming` if needed).
- **Incoming:** the planned section changes.
- **Active:** this is a transfer, and it needs a `reason`. An optional `date` sets when it takes effect. The family and both classes' coordinators and class teachers are told, and the move goes into the student's class history.
- The new section must be in the same curriculum and grade, or the call returns `400`. Moving up a grade happens only at the year-end promotion.
- The answer has the same shape as an admission result.

## `POST /admissions/cancel`: cancel before joining

```json
{ "id": "APP-2027-0153", "reason": "Family chose another school" }
```

- For an **incoming** student, the admission is removed. A family account opened only for it is removed too. The audit log keeps the cancellation, and the admin team is told.
- For a student who has **already joined**, the call returns `409`. Only the school withdraws a student, in Broadway under **Student records**, because fees, attendance and records are involved.

The tracker can change or cancel only students it sent itself. Any other student returns `403`.

## From the old ERP calls to the new ones

| Old ERP call | Now |
|---|---|
| Capacity sync (cron `/api/cron/erp-capacity-sync` → `erp_classes`) | The same cron calls `GET /classes` and caches the result |
| Student roster sync (`erp_students`) | The same cron pages through `GET /students?limit=500&offset=…` |
| Section push (`syncClassToErp`) | `POST /classes` when a section is saved. Store the returned `classId` on the section |
| Admission push (`syncEnrollmentToErp`) | `POST /admissions` with `classId`. A missing link, or a "no section" warning, still raises the `no_mapping` alert |
| Deactivation | Deleting a section: `POST /classes/remove` (`409` while it is used). Withdrawing an application: `POST /admissions/cancel` (`409` once joined) |
| Transfer | `POST /admissions/section` with a `reason` |
