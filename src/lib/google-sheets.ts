import "server-only";
import crypto from "node:crypto";
import { config } from "@/lib/config";

// ---------------------------------------------------------------------------
// Google Sheets export via a service account (machine-to-machine, no user
// OAuth flow) — same pattern as lib/zoom.ts / lib/erp.ts: server-only,
// config-gated, boundary functions never throw. One spreadsheet, one tab per
// class, so each class teacher can be pointed at just their own tab.
// ---------------------------------------------------------------------------

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Signs a service-account JWT and exchanges it for a short-lived OAuth
// access token — the standard Google server-to-server auth flow, hand-rolled
// with Node's built-in crypto rather than pulling in google-auth-library.
async function getAccessToken(): Promise<string | null> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT" };
    const claim = {
      iss: config.googleSheets.clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      exp: now + 3600,
      iat: now,
    };
    const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(unsigned);
    const signature = base64url(signer.sign(config.googleSheets.privateKey));
    const jwt = `${unsigned}.${signature}`;

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });
    if (!res.ok) {
      console.error(`[google-sheets] token request failed (${res.status}): ${await res.text()}`);
      return null;
    }
    const json = (await res.json()) as { access_token: string };
    return json.access_token;
  } catch (err) {
    console.error("[google-sheets] token request threw", err);
    return null;
  }
}

// A literal single quote inside a sheet/tab name is escaped as two single
// quotes in A1 notation; the whole name is always quoted since class names
// routinely contain spaces/dashes.
function a1Range(tabName: string, cell: string): string {
  return `'${tabName.replace(/'/g, "''")}'!${cell}`;
}

// Sheet/tab names can't contain : \ / ? * [ ] and are capped at 100 chars.
export function sanitizeTabName(name: string): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, "-").trim();
  return cleaned.slice(0, 100) || "Unassigned";
}

const HEADERS = [
  "Admission No.",
  "Student Name",
  "DOB",
  "Gender",
  "Grade",
  "Section",
  "Class Timing",
  "Parent/Guardian",
  "Parent Phone",
  "Parent Email",
  "Father Name",
  "Father Phone",
  "Mother Name",
  "Mother Phone",
  "Address",
  "Previous School",
  "Curriculum",
  "PEN Number",
  "Enrolled On",
];

export interface EnrollmentSheetRow {
  admissionNumber: string;
  studentName: string;
  dob: string | null;
  gender: string | null;
  grade: string | null;
  sectionName: string | null;
  classTiming: string | null;
  parentName: string;
  parentPhone: string;
  parentEmail: string | null;
  fatherName: string | null;
  fatherPhone: string | null;
  motherName: string | null;
  motherPhone: string | null;
  address: string | null;
  previousSchool: string | null;
  curriculum: string | null;
  penNumber: string | null;
  enrolledOn: string;
}

function rowValues(r: EnrollmentSheetRow): string[] {
  return [
    r.admissionNumber,
    r.studentName,
    r.dob ?? "",
    r.gender ?? "",
    r.grade ?? "",
    r.sectionName ?? "",
    r.classTiming ?? "",
    r.parentName,
    r.parentPhone,
    r.parentEmail ?? "",
    r.fatherName ?? "",
    r.fatherPhone ?? "",
    r.motherName ?? "",
    r.motherPhone ?? "",
    r.address ?? "",
    r.previousSchool ?? "",
    r.curriculum ?? "",
    r.penNumber ?? "",
    r.enrolledOn,
  ];
}

type OkOrError = { ok: true } | { ok: false; error: string };

// Creates the tab with a header row if it doesn't exist yet. If two
// enrollments race to create the same brand-new tab, a "already exists"
// failure from the create call is treated as success rather than an error —
// the other request's tab is just as good as one created here.
async function ensureTabExists(accessToken: string, tabName: string): Promise<OkOrError> {
  const metaRes = await fetch(
    `${SHEETS_API}/${config.googleSheets.spreadsheetId}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!metaRes.ok) {
    return { ok: false, error: `metadata fetch failed (${metaRes.status}): ${await metaRes.text()}` };
  }
  const meta = (await metaRes.json()) as { sheets?: { properties: { title: string } }[] };
  const existing = new Set((meta.sheets ?? []).map((s) => s.properties.title));
  if (existing.has(tabName)) return { ok: true };

  const createRes = await fetch(`${SHEETS_API}/${config.googleSheets.spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tabName } } }] }),
  });
  if (!createRes.ok) {
    const text = await createRes.text();
    if (text.includes("already exists")) return { ok: true };
    return { ok: false, error: `create tab failed (${createRes.status}): ${text}` };
  }

  const headerRes = await fetch(
    `${SHEETS_API}/${config.googleSheets.spreadsheetId}/values/${encodeURIComponent(a1Range(tabName, "A1"))}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [HEADERS] }),
    },
  );
  if (!headerRes.ok) {
    return { ok: false, error: `header write failed (${headerRes.status}): ${await headerRes.text()}` };
  }
  return { ok: true };
}

// Appends one enrolled student as a new row on their class's tab, creating
// the tab (with a header row) first if this is the first student in it.
// Never throws.
export async function appendEnrollmentRow(row: EnrollmentSheetRow, tabName: string): Promise<OkOrError> {
  if (!config.googleSheets.enabled) return { ok: false, error: "Google Sheets integration not configured" };
  try {
    const token = await getAccessToken();
    if (!token) return { ok: false, error: "Could not authenticate with Google" };

    const tabResult = await ensureTabExists(token, tabName);
    if (!tabResult.ok) return tabResult;

    const appendRes = await fetch(
      `${SHEETS_API}/${config.googleSheets.spreadsheetId}/values/${encodeURIComponent(a1Range(tabName, "A:A"))}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values: [rowValues(row)] }),
      },
    );
    if (!appendRes.ok) {
      return { ok: false, error: `append failed (${appendRes.status}): ${await appendRes.text()}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
