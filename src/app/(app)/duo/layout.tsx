import type { ReactNode } from "react";

import { DuoShell } from "@/modules/duo/components/duo-shell";

export default function DuoLayout({ children }: { children: ReactNode }) {
  return <DuoShell>{children}</DuoShell>;
}
