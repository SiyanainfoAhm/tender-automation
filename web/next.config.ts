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
  // Keep pdf-parse + native canvas out of the bundler (DOMMatrix / worker).
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
  experimental: {
    // Bid Workspace sends its allowed (up to 200 MB) document to the document
    // service through a Server Action before the service writes it to
    // SharePoint.  Keep this in sync with MAX_SINGLE_SHOT_UPLOAD_BYTES.
    // A smaller value rejects the multipart request before the action can
    // return a useful upload error, which surfaces as React error #441.
    serverActions: {
      bodySizeLimit: "200mb",
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
