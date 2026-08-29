import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { config } from "@/lib/config";
import type { UserRole } from "@/lib/types";

interface DemoUser {
  email: string;
  passwordEnvVar: string;
  role: UserRole;
  full_name: string;
}

// Passwords are never hardcoded and never echoed back — set them yourself in
// .env.local before seeding, the same way you'd set any other secret.
const DEMO_USERS: DemoUser[] = [
  { email: "admin@admission.local", passwordEnvVar: "SETUP_ADMIN_PASSWORD", role: "admin", full_name: "Admin User" },
  { email: "marketing@admission.local", passwordEnvVar: "SETUP_MARKETING_PASSWORD", role: "marketing", full_name: "Marketing Team" },
  { email: "teacher@admission.local", passwordEnvVar: "SETUP_TEACHER_PASSWORD", role: "teacher", full_name: "Assessment Teacher" },
  { email: "classteacher@admission.local", passwordEnvVar: "SETUP_CLASS_TEACHER_PASSWORD", role: "class_teacher", full_name: "Class Teacher" },
];

// One-time local-dev setup: seed demo staff accounts (auth users + role
// profiles). Disabled in production unless ALLOW_SETUP_ROUTE is explicitly
// set. Guarded by SETUP_SECRET (no default — must be set, or every request
// is rejected). Trigger with: GET /api/setup?secret=<SETUP_SECRET>
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
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_SETUP_ROUTE) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!config.setupSecret || !secret || secret !== config.setupSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createSupabaseAdminClient();

  const results: { email: string; role: UserRole; status: string }[] = [];

  for (const u of DEMO_USERS) {
    const password = process.env[u.passwordEnvVar];
    if (!password) {
      results.push({ email: u.email, role: u.role, status: `skipped (set ${u.passwordEnvVar})` });
      continue;
    }

    let userId: string | null = null;

    const created = await admin.auth.admin.createUser({
      email: u.email,
      password,
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
    message: "Demo staff ready (where a password env var was set). Sign in at /login.",
    results,
  });
}
