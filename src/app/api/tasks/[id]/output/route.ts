import type { NextRequest } from "next/server";

import { jobOutput } from "@/lib/tasks-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Raw log/output for one job (`/jobs/{id}/output`). Powers the task drawer logs. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const output = await jobOutput(id);
    return Response.json({ output });
  } catch {
    return Response.json({ output: "" });
  }
}
