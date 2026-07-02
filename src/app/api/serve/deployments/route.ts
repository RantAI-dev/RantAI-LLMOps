import { readDeploymentStore, writeDeploymentStore } from "@/lib/deployment-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Saved deployment configs (named "serve model X" choices), persisted server-side
 * so they're shared across everyone using this app instance. GET reads the list;
 * PUT replaces it (the client does read-modify-write — fine at team scale).
 */
export async function GET() {
  return Response.json(await readDeploymentStore());
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({}));
  const saved = await writeDeploymentStore({
    deployments: Array.isArray(body?.deployments) ? body.deployments : [],
    activeId: typeof body?.activeId === "string" ? body.activeId : null,
  });
  return Response.json(saved);
}
