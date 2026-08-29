import type { NextConfig } from "next";

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
        headers: [{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }],
      },
    ];
  },
};

export default nextConfig;
