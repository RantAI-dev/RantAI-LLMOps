import {
  Activity,
  BookOpen,
  Boxes,
  Code2,
  FlaskConical,
  FolderOpen,
  Gauge,
  GraduationCap,
  MessageSquare,
  ShieldCheck,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type DuoSectionId =
  | "chat"
  | "rooms"
  | "knowledge"
  | "files"
  | "code"
  | "quality"
  | "learning"
  | "experiments"
  | "cache"
  | "speed"
  | "status"
  | "models";

export type DuoSection = { id: DuoSectionId; label: string; href: string; icon: LucideIcon; hint: string; group: "use" | "insights" };

/** The Semantic Duo pages, in sidebar order. The original Nafs-Aql web app has the same pages (rust/crates/nafs-web). */
export const DUO_SECTIONS: DuoSection[] = [
  { id: "chat", label: "Chat", href: "/duo", icon: MessageSquare, group: "use", hint: "Ask; System 1 answers fast, System 2 takes over when the answer needs care" },
  { id: "rooms", label: "Rooms", href: "/duo/rooms", icon: Users, group: "use", hint: "Shared chats several people talk in together" },
  { id: "knowledge", label: "Knowledge", href: "/duo/knowledge", icon: BookOpen, group: "use", hint: "Your documents, searchable and ready for questions" },
  { id: "files", label: "Files & memory", href: "/duo/files", icon: FolderOpen, group: "use", hint: "Documents, memories, skills and saved chats in one place" },
  { id: "code", label: "Code", href: "/duo/code", icon: Code2, group: "use", hint: "A small program, written and checked against your tests" },
  { id: "quality", label: "Quality", href: "/duo/quality", icon: ShieldCheck, group: "insights", hint: "How reliable the answers are: the gate, checks, audits and drift" },
  { id: "learning", label: "Learning", href: "/duo/learning", icon: GraduationCap, group: "insights", hint: "How checked answers become training data for the quick model" },
  { id: "experiments", label: "Experiments", href: "/duo/experiments", icon: FlaskConical, group: "insights", hint: "Compare answering strategies on test sets" },
  { id: "cache", label: "Cache", href: "/duo/cache", icon: Zap, group: "insights", hint: "Careful answers kept as working that runs again" },
  { id: "speed", label: "Speed", href: "/duo/speed", icon: Gauge, group: "insights", hint: "Response times, where the time goes, and load tests" },
  { id: "status", label: "Status", href: "/duo/status", icon: Activity, group: "insights", hint: "Models, settings in force and health" },
  { id: "models", label: "Models", href: "/duo/models", icon: Boxes, group: "insights", hint: "Change the System 1 / System 2 models or adapters" },
];

/** The section a pathname belongs to (`/duo` is Chat). */
export function sectionOf(pathname: string): DuoSection {
  const seg = pathname.replace(/^\/duo\/?/, "").split("/")[0];
  return DUO_SECTIONS.find((s) => s.id === seg) ?? DUO_SECTIONS[0];
}
