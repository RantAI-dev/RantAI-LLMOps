"use client";

import { useParams } from "next/navigation";

import { ExperimentNotesEditor } from "@/modules/experiments";

export default function Page() {
  const params = useParams<{ experimentId: string }>();
  return <ExperimentNotesEditor experimentId={params.experimentId} />;
}
