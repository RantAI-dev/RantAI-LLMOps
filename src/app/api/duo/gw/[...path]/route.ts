import type { NextRequest } from "next/server";

import { guardApi } from "@/lib/auth";
import { duoProxy } from "@/lib/duo-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A System 2 answer, a document upload or an export can take minutes.
export const maxDuration = 900;

type Ctx = { params: Promise<{ path: string[] }> };

/** Semantic Duo pages → Rantai-Aql gateway, for the routes listed in DUO_ROUTES (src/lib/duo-proxy.ts). */
async function handle(req: NextRequest, { params }: Ctx) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const { path } = await params;
  return duoProxy(req, path);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
