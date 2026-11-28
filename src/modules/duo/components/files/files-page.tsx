"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageIntro } from "@/modules/duo/components/duo-ui";
import { FsBrowser } from "@/modules/duo/components/files/fs-browser";
import { MemoryNotes } from "@/modules/duo/components/files/memory-notes";

/** /duo/files: everything the assistant knows has an address (nafs://…), plus the notes it remembers from chats. */
export function FilesPage() {
  return (
    <div className="grid gap-3">
      <PageIntro title="Files & memory">
        Everything the assistant knows has an address: your documents, what it remembers about you, its skills and saved chats. Open a folder to see a
        one-line summary of each item, and read any item as a summary, an overview or in full.
      </PageIntro>
      <Tabs defaultValue="files">
        <TabsList>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="notes">Remembered notes</TabsTrigger>
        </TabsList>
        <TabsContent value="files" className="mt-1">
          <FsBrowser />
        </TabsContent>
        <TabsContent value="notes" className="mt-1">
          <MemoryNotes />
        </TabsContent>
      </Tabs>
    </div>
  );
}
