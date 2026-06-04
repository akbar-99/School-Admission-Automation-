import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Admission documents can be up to 5 MB each (SRS FR-4a); allow a few per
    // multipart Server Action submission.
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
