import "server-only";

import { config } from "@/lib/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Zoom Server-to-Server OAuth client.
//
// The school owns a single licensed Zoom account with a Server-to-Server OAuth
// app (ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET). Meetings are
// created under each assessment teacher's own Zoom user (by email) so several
// assessments can run at the same time, each hosted by its teacher.
// ---------------------------------------------------------------------------

// Account-level access token, cached in-process (Zoom tokens last ~1 hour).
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.token;

  const creds = Buffer.from(
    `${config.zoom.clientId}:${config.zoom.clientSecret}`,
  ).toString("base64");
  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(
      config.zoom.accountId,
    )}`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    },
  );
  if (!res.ok) {
    throw new Error(`Zoom auth failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: json.access_token, expiresAt: now + json.expires_in * 1000 };
  return json.access_token;
}

export interface ZoomMeeting {
  id: string;
  joinUrl: string; // student/parent
  startUrl: string; // host (assessment teacher)
  passcode: string | null;
}

interface CreateMeetingInput {
  hostEmail: string; // a Zoom user on the account (teacher email, or fallback host)
  topic: string;
  startTimeISO: string; // UTC instant
  durationMinutes: number;
  timezone: string; // IANA, e.g. "Asia/Kolkata"
}

// Create a scheduled meeting under `hostEmail`. If that user isn't on the Zoom
// account (404) and a default host is configured, retry under the default host.
async function createZoomMeeting(input: CreateMeetingInput): Promise<ZoomMeeting> {
  const token = await getAccessToken();
  const body = JSON.stringify({
    topic: input.topic,
    type: 2, // scheduled meeting
    start_time: input.startTimeISO,
    duration: input.durationMinutes,
    timezone: input.timezone,
    settings: {
      join_before_host: false,
      waiting_room: true,
      host_video: true,
      participant_video: true,
      mute_upon_entry: true,
      audio: "both",
    },
  });

  const post = (host: string) =>
    fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(host)}/meetings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body,
    });

  let res = await post(input.hostEmail);
  if (
    res.status === 404 &&
    config.zoom.defaultHostEmail &&
    config.zoom.defaultHostEmail !== input.hostEmail
  ) {
    res = await post(config.zoom.defaultHostEmail);
  }
  if (!res.ok) {
    throw new Error(`Zoom meeting create failed (${res.status}): ${await res.text()}`);
  }
  const m = (await res.json()) as {
    id: number;
    join_url: string;
    start_url: string;
    password?: string;
  };
  return {
    id: String(m.id),
    joinUrl: m.join_url,
    startUrl: m.start_url,
    passcode: m.password ?? null,
  };
}

// ---------------------------------------------------------------------------
// Ensure the booked slot for an application has a Zoom meeting.
//
// Idempotent: returns the existing meeting if one was already created, so it's
// safe to call again. Never throws — a Zoom outage must not break booking; it
// returns null and the flow continues without a link (the link can be created
// on a later trigger). Returns null when Zoom isn't configured.
// ---------------------------------------------------------------------------
export async function ensureZoomForApplication(
  appId: string,
): Promise<ZoomMeeting | null> {
  if (!config.zoom.enabled) return null;

  const admin = createSupabaseAdminClient();
  const { data: slot } = await admin
    .from("assessment_slots")
    .select(
      "id, starts_at, ends_at, teacher_id, zoom_meeting_id, zoom_join_url, zoom_start_url, zoom_passcode",
    )
    .eq("application_id", appId)
    .maybeSingle();
  if (!slot) return null;

  // Already created — return it (idempotent).
  if (slot.zoom_join_url && slot.zoom_start_url) {
    return {
      id: slot.zoom_meeting_id ?? "",
      joinUrl: slot.zoom_join_url,
      startUrl: slot.zoom_start_url,
      passcode: slot.zoom_passcode ?? null,
    };
  }

  try {
    // Host = the assigned teacher's Zoom account. Prefer the explicit zoom_email
    // set by an admin (Staff page), then the login email, then the default host.
    let hostEmail = config.zoom.defaultHostEmail;
    if (slot.teacher_id) {
      const { data: teacher } = await admin
        .from("users")
        .select("email, zoom_email")
        .eq("id", slot.teacher_id)
        .maybeSingle();
      const teacherHost = teacher?.zoom_email || teacher?.email;
      if (teacherHost) hostEmail = teacherHost;
    }
    if (!hostEmail) {
      console.error("[zoom] no host email (teacher or ZOOM_DEFAULT_HOST_EMAIL) for app", appId);
      return null;
    }

    // Topic — include the applicant's name and grade when available.
    const { data: app } = await admin
      .from("applications")
      .select("grade_applying, students(full_name)")
      .eq("id", appId)
      .maybeSingle();
    const students = app?.students as
      | { full_name: string | null }
      | { full_name: string | null }[]
      | null
      | undefined;
    const studentName =
      (Array.isArray(students) ? students[0]?.full_name : students?.full_name) ?? "Applicant";
    const grade = app?.grade_applying ? ` (Grade ${app.grade_applying})` : "";
    const topic = `Admission Assessment — ${studentName}${grade}`;

    const startMs = new Date(slot.starts_at).getTime();
    const endMs = new Date(slot.ends_at).getTime();
    const durationMinutes = Math.max(15, Math.round((endMs - startMs) / 60_000) || 30);

    const meeting = await createZoomMeeting({
      hostEmail,
      topic,
      startTimeISO: new Date(slot.starts_at).toISOString(),
      durationMinutes,
      timezone: config.school.timezone,
    });

    await admin
      .from("assessment_slots")
      .update({
        zoom_meeting_id: meeting.id,
        zoom_join_url: meeting.joinUrl,
        zoom_start_url: meeting.startUrl,
        zoom_passcode: meeting.passcode,
        zoom_created_at: new Date().toISOString(),
      })
      .eq("id", slot.id);

    return meeting;
  } catch (err) {
    console.error("[zoom] failed to create meeting for app", appId, err);
    return null;
  }
}
