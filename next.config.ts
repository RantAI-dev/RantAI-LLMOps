import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

import { MAX_PDF_UPLOAD_SIZE } from "./src/lib/upload-limits";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// Content-Security-Policy tuned for a Next.js App Router app.
// - 'unsafe-inline' in style-src is required: Next injects inline <style> for
//   its CSS and next/font emits inline style attributes.
// - script-src keeps 'unsafe-inline' for pragmatism (Next inlines a small
//   bootstrap/flight payload). The stricter future step is a nonce-based CSP
//   (generate a per-request nonce in middleware and drop 'unsafe-inline') —
//   deferred here to avoid breaking hydration on this build.
// - DEVELOPMENT ONLY relaxations (never sent in production, so prod stays strict):
//   * 'unsafe-eval' in script-src — React dev mode uses eval() for Fast Refresh
//     and debugging (React never uses eval() in production).
//   * ws:/wss: in connect-src — Next's dev HMR runs over a WebSocket.
// - connect-src allows the Hugging Face Hub for the in-app model/dataset browser.
const isProd = process.env.NODE_ENV === "production";
const scriptSrc = isProd
  ? "script-src 'self' 'unsafe-inline'"
  : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
const connectSrc = isProd
  ? "connect-src 'self' https://huggingface.co"
  : "connect-src 'self' https://huggingface.co ws: wss:";
const contentSecurityPolicy = [
  "default-src 'self'",
  "img-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline'",
  scriptSrc,
  connectSrc,
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // pdfjs-dist ships its own Node ("legacy") build and resolves worker/cmap files
  // at runtime; bundling it into the server chunk breaks that. `/api/corpus/*` is
  // the only consumer — see src/lib/pdf-extract.ts.
  serverExternalPackages: ["pdfjs-dist"],
  experimental: {
    // `src/proxy.ts` gates /api/*, and Next buffers a proxied body so both the
    // proxy and the route can read it — default 10 MB, above which the body is
    // silently TRUNCATED rather than rejected. Corpus PDFs are bigger than that,
    // so raise it to the limit the upload route enforces. See src/lib/upload-limits.ts.
    proxyClientMaxBodySize: MAX_PDF_UPLOAD_SIZE,
  },
  // Turbopack disabled in Docker builds (DOCKER_BUILD=1) — standalone output not generated with turbopack+NFT warning
  ...(process.env.DOCKER_BUILD !== "1" && {
    turbopack: {
      root: projectRoot,
    },
  }),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
