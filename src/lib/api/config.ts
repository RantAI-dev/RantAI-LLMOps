/**
 * API transport config (direct browser → Transformer Lab).
 *
 * Everything defaults to MOCK. Flip `NEXT_PUBLIC_USE_REAL_API=true` (and point
 * `NEXT_PUBLIC_TL_API_URL` at a running TL server) to switch services from mock
 * data to real `fetch` calls — without touching any UI component.
 */
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_TL_API_URL ?? "http://localhost:8338"
).replace(/\/$/, "");

export const USE_REAL_API = process.env.NEXT_PUBLIC_USE_REAL_API === "true";
