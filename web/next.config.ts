import type { NextConfig } from "next";

const SECURITY_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.blob.core.windows.net https://*.sharepoint.com; font-src 'self' data:; connect-src 'self' https://*.blob.core.windows.net https://*.sharepoint.com; frame-src 'self' blob:; object-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "interest-cohort=()" },
  {
    key: "Content-Security-Policy",
    value: SECURITY_CSP,
  },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  experimental: {
    // Keep small: large files must use Azure direct upload, not Server Actions.
    // Raising this does NOT bypass Vercel's infrastructure FUNCTION_PAYLOAD_TOO_LARGE limit.
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
