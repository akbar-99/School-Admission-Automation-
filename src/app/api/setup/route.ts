import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { config } from "@/lib/config";
import type { UserRole } from "@/lib/types";

interface DemoUser {
  email: string;
  password: string;
  role: UserRole;
  full_name: string;
}

const DEMO_USERS: DemoUser[] = [
  { email: "admin@admission.local", password: "Admin@12345", role: "admin", full_name: "Admin User" },
  { email: "marketing@admission.local", password: "Market@12345", role: "marketing", full_name: "Marketing Team" },
  { email: "teacher@admission.local", password: "Teacher@12345", role: "teacher", full_name: "Assessment Teacher" },
  { email: "classteacher@admission.local", password: "Class@12345", role: "class_teacher", full_name: "Class Teacher" },
];

// One-time setup: seed demo staff accounts (auth users + role profiles).
// Guarded by SETUP_SECRET. Trigger with: GET /api/setup?secret=<SETUP_SECRET>
export async function GET(request: Request) {
  const secret = new URL(request.url).searchParams.get("secret");
  return run(secret);
}

export async function POST(request: Request) {
  const secret =
    request.headers.get("x-setup-secret") ??
    new URL(request.url).searchParams.get("secret");
  return run(secret);
}

async function run(secret: string | null) {
  if (!secret || secret !== config.setupSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createSupabaseAdminClient();

  const results: { email: string; role: UserRole; status: string }[] = [];

  for (const u of DEMO_USERS) {
    let userId: string | null = null;

    const created = await admin.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
    });

    if (created.data?.user) {
      userId = created.data.user.id;
    } else {
      // Likely already exists — locate by scanning the user list.
      const list = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      userId = list.data?.users.find((x) => x.email === u.email)?.id ?? null;
    }

    if (!userId) {
      results.push({ email: u.email, role: u.role, status: "failed" });
      continue;
    }

    await admin.from("users").upsert(
      { id: userId, role: u.role, full_name: u.full_name, email: u.email },
      { onConflict: "id" },
    );
    results.push({
      email: u.email,
      role: u.role,
      status: created.data?.user ? "created" : "exists",
    });
  }

  return NextResponse.json({
    ok: true,
    message: "Demo staff ready. Sign in at /login.",
    credentials: DEMO_USERS.map((u) => ({ email: u.email, password: u.password, role: u.role })),
    results,
  });
}
