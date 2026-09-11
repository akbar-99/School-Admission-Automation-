import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Next.js 16: Middleware is called "Proxy". Refreshes the Supabase auth cookie
// on every request and performs an optimistic redirect for staff areas. Real
// authorization is enforced server-side via requireRole().
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isStaffArea = /^\/(admin|marketing|teacher)(\/|$)/.test(path);

  // Only /admin, /marketing and /teacher ever read the Supabase session
  // cookie or need this redirect check. Skip the auth round-trip (a real
  // network call to Supabase's auth server) entirely for everything else —
  // the parent-facing /apply/* flow, webhooks, cron endpoints, /login itself
  // — which used to pay for it on every single request.
  if (!isStaffArea) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
