"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DuoPair } from "@/modules/duo/components/duo-pair";
import { DuoPlayground } from "@/modules/duo/components/duo-playground";
import { DuoStrategies } from "@/modules/duo/components/duo-strategies";

/** /duo: talk to the System 1 + System 2 pair, compare how the strategies trade accuracy for time, or change their models. */
export function DuoPage() {
  return (
    <Tabs defaultValue="chat" className="h-full min-h-0">
      <TabsList className="h-auto w-full justify-start gap-1 rounded-lg border border-hairline bg-surface p-1">
        <TabsTrigger value="chat">Chat</TabsTrigger>
        <TabsTrigger value="strategies">Compare strategies</TabsTrigger>
        <TabsTrigger value="models">Models</TabsTrigger>
      </TabsList>
      <TabsContent value="chat" className="mt-2 min-h-0 flex-1">
        <DuoPlayground />
      </TabsContent>
      <TabsContent value="strategies" className="mt-2">
        <DuoStrategies />
      </TabsContent>
      <TabsContent value="models" className="mt-2">
        <DuoPair />
      </TabsContent>
    </Tabs>
  );
}
