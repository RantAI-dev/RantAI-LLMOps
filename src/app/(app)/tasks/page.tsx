import { Suspense } from "react";

import { TasksPage } from "@/modules/tasks";

// TasksPage reads the `?task=` query param (useSearchParams) to drive the detail
// drawer, so it needs a Suspense boundary.
export default function Page() {
  return (
    <Suspense>
      <TasksPage />
    </Suspense>
  );
}
