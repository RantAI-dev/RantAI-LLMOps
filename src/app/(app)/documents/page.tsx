"use client";

import { useRouter } from "next/navigation";

import { DocumentsPage } from "@/modules/datasets";

const MENU_ROUTE: Record<"Interact" | "Evals" | "Dataset", string> = {
  Interact: "/interact",
  Evals: "/evals",
  Dataset: "/datasets",
};

export default function Page() {
  const router = useRouter();
  // The knowledge-base id is dropped for now (parity with the previous
  // SPA behaviour). Wiring it as `?kb=<id>` + DatasetsPage.initialSelectedId
  // would make the KB deep-linkable — a cheap future enhancement.
  return <DocumentsPage onNavigate={(menu) => router.push(MENU_ROUTE[menu])} />;
}
