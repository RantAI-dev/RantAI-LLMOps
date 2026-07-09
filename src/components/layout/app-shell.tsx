"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ComponentType } from "react";
import {
  Bell,
  Boxes,
  BrainCog,
  Columns2,
  Compass,
  ChevronUp,
  Database,
  FlaskConical,
  House,
  ListTodo,
  LogOut,
  MessageSquareMore,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Search,
  Settings,
  Sparkles,
  Workflow,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/modules/auth";
import { isNavMock } from "@/lib/feature-status";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
};

/** Main app navigation — Dashboard first, then operations. */
const mainNav: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: House },
  { label: "Tasks", href: "/tasks", icon: ListTodo },
  { label: "Interact", href: "/interact", icon: MessageSquareMore },
  { label: "Fine-tune", href: "/finetune", icon: Sparkles },
  { label: "Evals", href: "/evals", icon: FlaskConical },
  { label: "Generations", href: "/generations", icon: Columns2 },
  { label: "Workflows", href: "/workflows", icon: Workflow },
  { label: "Deployments", href: "/serve", icon: Radio },
  { label: "Notes", href: "/notes", icon: NotebookPen },
];

const workspaceNav: NavItem[] = [
  { label: "Hub", href: "/hub", icon: Compass },
  { label: "Model Registry", href: "/models", icon: Boxes },
  { label: "Dataset", href: "/datasets", icon: Database },
  { label: "Compute", href: "/compute", icon: BrainCog },
];

/** App-wide settings — pinned to the sidebar bottom, above the account menu. */
const bottomNav: NavItem[] = [{ label: "Settings", href: "/settings", icon: Settings }];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const initials =
    (user?.name ?? "U").replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "U";

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const renderNav = (items: NavItem[]) => (
    <div className="space-y-1">
      {items.map((item) => {
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            title={item.label}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex h-9 w-full items-center rounded-lg text-left text-sm leading-5 transition-all",
              isSidebarOpen ? "gap-2 px-3" : "justify-center px-0",
              active
                ? "bg-sidebar-accent font-medium text-sidebar-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-hover hover:text-sidebar-foreground"
            )}
          >
            {isSidebarOpen ? (
              <span
                className={cn(
                  "absolute left-0 top-1/2 w-1 -translate-y-1/2 rounded-r-sm bg-sidebar-foreground transition-all duration-150 ease-in-out",
                  active ? "h-6 opacity-100" : "h-2 opacity-0 group-hover:h-4 group-hover:opacity-100"
                )}
                aria-hidden
              />
            ) : null}
            <item.icon className="size-4 shrink-0" aria-hidden />
            {isSidebarOpen ? (
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            ) : null}
            {isNavMock(item.label) ? (
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full bg-red-500",
                  isSidebarOpen ? "" : "absolute top-1 right-1"
                )}
                title="Belum terhubung ke backend (mock)"
                aria-hidden
              />
            ) : null}
            {isSidebarOpen && item.label === "Interact" ? (
              <ChevronUp className="size-4 shrink-0" aria-hidden />
            ) : null}
          </Link>
        );
      })}
    </div>
  );

  return (
    <main className="flex h-dvh overflow-hidden bg-background text-sm leading-5 text-foreground">
      <div className="flex h-full min-h-0 w-full">
        <aside
          className={cn(
            "flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
            isSidebarOpen ? "w-[214px]" : "w-[70px]"
          )}
        >
          <div className={cn("border-b border-sidebar-border py-3", isSidebarOpen ? "px-4" : "px-3")}>
            <Link
              href="/dashboard"
              title="Home"
              className={cn(
                "flex h-12 w-full items-center rounded-lg transition-colors hover:bg-sidebar-hover",
                isSidebarOpen ? "gap-2 px-1" : "justify-center"
              )}
            >
              <div className="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded bg-white shadow-[0_2px_6px_rgba(0,0,0,0.12)]">
                <Image
                  src="/rantai-logo.png"
                  alt="RantAI"
                  width={32}
                  height={32}
                  className="object-contain p-0.5"
                  priority
                  unoptimized
                />
              </div>
              {isSidebarOpen ? (
                <div className="text-left">
                  <p className="text-sm leading-none font-semibold text-sidebar-foreground">RantAI</p>
                  <p className="mt-1 text-sm leading-none text-sidebar-muted">LLMOps</p>
                </div>
              ) : null}
            </Link>
          </div>

          <div className={cn("flex-1 space-y-6 py-3", isSidebarOpen ? "px-2" : "px-3")}>
            <nav aria-label="Main">
              {isSidebarOpen ? (
                <p className="px-2 py-1 text-sm leading-5 font-medium text-sidebar-muted">Main</p>
              ) : null}
              {renderNav(mainNav)}
            </nav>

            <nav aria-label="Workspace">
              {isSidebarOpen ? (
                <p className="px-2 py-1 text-sm leading-5 font-medium text-sidebar-muted">Workspace</p>
              ) : null}
              {renderNav(workspaceNav)}
            </nav>
          </div>

          <div className={cn("border-t border-sidebar-border py-2", isSidebarOpen ? "px-2" : "px-3")}>
            <nav aria-label="Settings">{renderNav(bottomNav)}</nav>
          </div>

          <div className={cn("p-2", isSidebarOpen ? "" : "px-3")}>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    title="Account"
                    className={cn(
                      "flex min-h-12 w-full items-center rounded-lg transition-colors outline-none hover:bg-sidebar-hover",
                      isSidebarOpen ? "gap-2 px-2" : "justify-center"
                    )}
                  >
                    <Avatar>
                      <AvatarFallback className="bg-sidebar-accent text-sidebar-foreground">{initials}</AvatarFallback>
                    </Avatar>
                    {isSidebarOpen ? (
                      <>
                        <div className="min-w-0 flex-1 text-left">
                          <p className="truncate text-sm leading-5 font-semibold text-sidebar-foreground">{user?.name ?? "—"}</p>
                          <p className="truncate text-sm leading-5 text-sidebar-muted">{user?.email ?? ""}</p>
                        </div>
                        <LogOut className="size-4 shrink-0 text-sidebar-muted" aria-hidden />
                      </>
                    ) : null}
                  </button>
                }
              />
              <DropdownMenuContent side="top" align="start" className="w-[200px]">
                <div className="px-2 py-1.5">
                  <p className="truncate text-[13px] font-semibold text-ink">{user?.name ?? "—"}</p>
                  <p className="truncate text-xs font-normal text-ink-soft">{user?.email ?? ""}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onClick={logout}>
                  <LogOut className="size-4" /> Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <header className="shrink-0 border-b border-border bg-background px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsSidebarOpen((previous) => !previous)}
                  className="grid size-8 place-items-center rounded-md border border-input bg-background"
                  aria-label={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
                >
                  {isSidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
                </button>
                <div className="relative w-[260px] sm:w-[372px]">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-primary" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search..."
                    className="pl-9"
                  />
                </div>
              </div>
              <button
                type="button"
                className="grid size-9 place-items-center rounded-md text-foreground hover:bg-surface-2"
                aria-label="Notifications"
              >
                <Bell className="size-4" />
              </button>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-background p-4 scrollbar-thin">
            {children}
          </div>
        </section>
      </div>
    </main>
  );
}
