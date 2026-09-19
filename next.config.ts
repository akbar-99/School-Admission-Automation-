import type { NextConfig } from "next";

// The self-hosted Supabase instance's URL varies by environment/deployment,
// so the CSP's connect-src is built from it rather than hardcoded — both the
// https (REST/Storage) and wss (Realtime, used by the teacher/admin live
// alert widgets) forms are needed.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseWs = supabaseUrl.replace(/^http/, "ws");

// Required for Razorpay's hosted checkout (a full-page form POST to
// api.razorpay.com, not the JS popup widget) — without form-action and
// frame-src covering Razorpay's domains, the browser silently blocks the
// redirect/return with no visible error.
const ContentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://cdn.razorpay.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseUrl} ${supabaseWs} https://*.razorpay.com https://lumberjack.razorpay.com`,
  "frame-src https://api.razorpay.com https://checkout.razorpay.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://api.razorpay.com https://checkout.razorpay.com",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  // Next 16.3+ auto-rewrites a block in AGENTS.md on every `next dev` run.
  // This repo's AGENTS.md is hand-written and load-bearing (CLAUDE.md pulls
  // it in via @AGENTS.md) — opt out so Next stops touching it.
  agentRules: false,
  experimental: {
    // Admission documents can be up to 5 MB each (SRS FR-4a); allow a few per
    // multipart Server Action submission.
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
  // Parent admission links carry a bearer token in the URL path (SRS FR-2).
  // Assert the referrer policy explicitly rather than relying on browser
  // defaults, so it can't leak cross-origin regardless of user agent.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Content-Security-Policy", value: ContentSecurityPolicy },
          // Uploaded admission documents (PDF/JPG/PNG) are the only
          // user-supplied files this app ever serves back out (via signed
          // storage URLs) — stop the browser from MIME-sniffing them into
          // something else if a declared type is ever wrong.
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
