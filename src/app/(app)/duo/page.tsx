import { Suspense } from "react";

import { DuoChat } from "@/modules/duo/components/chat/duo-chat";

/** /duo: Semantic Duo chat (the default section). */
export default function Page() {
  return (
    <Suspense>
      <DuoChat />
    </Suspense>
  );
}
