"use client";

import { useState } from "react";
import { Cpu, Database, Gauge } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type AgentModel = {
  name: string;
  uptime: number;
  users: number;
  latency: number;
  speedGain: number;
};

const models: AgentModel[] = [
  { name: "Customer Service Agents", uptime: 99.31, users: 127, latency: 82, speedGain: 12 },
  { name: "Developer Agents", uptime: 93.82, users: 80, latency: 120, speedGain: 8 },
  { name: "Fraud Detection AI", uptime: 89.14, users: 40, latency: 220, speedGain: 12 },
  { name: "Product Recommender", uptime: 74.58, users: 2, latency: 360, speedGain: 12 },
];

const ui = {
  title: "text-2xl font-semibold leading-8 tracking-tight",
  subheading: "text-base leading-6 text-ink-soft",
  section: "text-lg font-semibold leading-7 tracking-tight",
  metric: "text-2xl font-semibold leading-8 tabular-nums tracking-tight",
  cardHeading: "text-base font-semibold leading-6",
} as const;

export default function Page() {
  const [activeTab, setActiveTab] = useState("list-models");

  return (
    <div className="flex min-w-0 flex-1 gap-3">
      <div className="min-w-0 flex-1 space-y-4">
        <div className="border-b border-border pb-3">
          <h1 className={cn("text-primary", ui.title)}>Dashboard</h1>
          <p className={cn("mt-1", ui.subheading)}>
            Overview of all your workloads and resources
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
          <Card className="shadow-[0_1px_2px_rgba(0,0,0,0.1)]">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="font-medium text-primary">Inference Latency</CardTitle>
                <div className="rounded bg-info-soft p-1">
                  <Gauge className="size-4 text-info-bright" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className={cn("text-primary", ui.metric)}>82ms</p>
              <p className="text-[14px] leading-5 text-success-bright">+12ms faster</p>
              <p className="text-[14px] leading-5 text-ink-soft">Active Users : 127</p>
            </CardContent>
          </Card>

          <Card className="shadow-[0_1px_2px_rgba(0,0,0,0.1)]">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="font-medium text-primary">Active Models</CardTitle>
                <div className="rounded bg-warning-soft p-1">
                  <Database className="size-4 text-warning-gold" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <p className={cn("text-primary", ui.metric)}>12</p>
              <p className="text-[14px] leading-5 text-ink-soft">15.420 API Request</p>
              <p className="text-[14px] leading-5 text-success-bright">+12 this month</p>
              <button type="button" className="text-left text-[14px] leading-5 font-medium text-primary hover:underline">
                View All
              </button>
            </CardContent>
          </Card>

          <Card className="shadow-[0_1px_2px_rgba(0,0,0,0.1)]">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="font-medium text-primary">Cost Summary</CardTitle>
                <div className="rounded bg-purple-soft p-1">
                  <span className="text-[14px] font-medium text-purple-bright">$</span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className={cn("text-primary", ui.metric)}>
                $2.560<span className="text-lg font-semibold text-ink-soft">/$5.000</span>
              </p>
              <Progress value={60} />
              <p className="text-[14px] leading-5 text-ink-soft">$94 for yesterday</p>
              <button type="button" className="text-left text-[14px] leading-5 font-medium text-primary hover:underline">
                View All
              </button>
            </CardContent>
          </Card>

          <Card className="shadow-[0_1px_2px_rgba(0,0,0,0.1)]">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="font-medium text-primary">Resource Utilization</CardTitle>
                <div className="rounded bg-success-soft p-1">
                  <Cpu className="size-4 text-success-bright" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="mb-1 flex justify-between text-[14px] leading-5 text-ink-soft">
                  <span>CPU</span>
                  <span>99.31%</span>
                </div>
                <Progress value={99.31} />
              </div>
              <div>
                <div className="mb-1 flex justify-between text-[14px] leading-5 text-ink-soft">
                  <span>GPU</span>
                  <span>62.31%</span>
                </div>
                <Progress value={62.31} />
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="rounded-lg border border-border">
          <div className="border-b border-border p-2">
            <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-[#ffe7d8] p-1">
              <TabsTrigger value="list-models">List Models</TabsTrigger>
              <TabsTrigger value="alerts">Alert &amp; Notification</TabsTrigger>
              <TabsTrigger value="training">Training Models</TabsTrigger>
              <TabsTrigger value="activity">Recent Activity</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="list-models" className="grid grid-cols-1 gap-2 p-2 lg:grid-cols-2">
            {models.map((model) => (
              <Card key={model.name} className="shadow-[0_1px_2px_rgba(0,0,0,0.1)]">
                <CardHeader className="pb-2">
                  <CardTitle className={cn("text-primary", ui.cardHeading)}>{model.name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-[14px] leading-5 text-ink-soft">Uptime</p>
                  <Progress value={model.uptime} />
                  <p className="text-[14px] leading-5 text-ink-soft">{model.uptime.toFixed(2)}%</p>
                  <p className="text-[14px] leading-5 text-ink-soft">Active Users : {model.users}</p>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="alerts" className="p-4 text-[14px] leading-5 text-ink-soft">
            Alerts and notification panel is ready for upcoming integration.
          </TabsContent>
          <TabsContent value="training" className="p-4 text-[14px] leading-5 text-ink-soft">
            Training model queue will appear here.
          </TabsContent>
          <TabsContent value="activity" className="p-4 text-[14px] leading-5 text-ink-soft">
            Recent activity timeline will appear here.
          </TabsContent>
        </Tabs>
      </div>

      <aside className="w-[260px] shrink-0 rounded-lg border border-border">
        <div className="flex items-center justify-between gap-2 border-b border-border p-4">
          <h2 className={cn("text-primary", ui.section)}>Top Models</h2>
          <span className="text-[14px] leading-5 text-ink-soft" aria-hidden>
            i
          </span>
        </div>
        <div className="space-y-3 p-4">
          {models.map((model) => (
            <div
              key={`${model.name}-top`}
              className="space-y-1 border-b border-border pb-3 last:border-none last:pb-0"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-[14px] leading-5 font-medium text-primary">{model.name}</p>
                <p className="shrink-0 text-[14px] leading-5 tabular-nums text-ink-soft">{model.latency}ms</p>
              </div>
              <div className="flex items-center justify-between gap-2 text-[14px] leading-5 text-ink-soft">
                <p>Active Users : {model.users}</p>
                <p className="text-success-bright">+{model.speedGain}ms faster</p>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
