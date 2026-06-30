import type { NextRequest } from "next/server";

import { searchHfDatasets } from "@/lib/hf-hub";
import { logServerError } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Search Hugging Face datasets (for the fine-tune dataset browser). */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  try {
    const datasets = await searchHfDatasets({
      search: sp.get("search") ?? undefined,
      sort: sp.get("sort") ?? undefined,
    });
    return Response.json({ datasets });
  } catch (err) {
    logServerError("hub/datasets", err);
    return Response.json({ error: "Could not reach Hugging Face", datasets: [] }, { status: 502 });
  }
}
