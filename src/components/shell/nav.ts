import { Home, Search, FileSearch, Workflow, LayoutGrid, Library, Settings, FileText, FileSpreadsheet, Presentation, FileType, type LucideIcon } from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  shortcut?: string;
  description?: string;
  children?: { label: string; href: string; icon?: LucideIcon }[];
}

export const NAV: NavItem[] = [
  { label: "Home", href: "/", icon: Home, shortcut: "G H", description: "Today, matters, tasks, calendar and the team's updates" },
  { label: "Search", href: "/search", icon: Search, shortcut: "G S", description: "Case law, statutes, regulations, dockets and internal knowledge" },
  { label: "E-Discovery", href: "/ediscovery", icon: FileSearch, shortcut: "G E", description: "Review, depositions, chronologies, people graph, privilege" },
  { label: "Workflows", href: "/workflows", icon: Workflow, shortcut: "G W", description: "Automations and multi-step agent playbooks" },
  {
    label: "Office",
    href: "/office",
    icon: LayoutGrid,
    shortcut: "G O",
    description: "Word, Excel, PowerPoint and PDF editors with drafting agents",
    children: [
      { label: "Documents", href: "/office?kind=word", icon: FileText },
      { label: "Workbooks", href: "/office?kind=sheet", icon: FileSpreadsheet },
      { label: "Decks", href: "/office?kind=slides", icon: Presentation },
      { label: "PDFs", href: "/office?kind=pdf", icon: FileType },
    ],
  },
  { label: "Library", href: "/library", icon: Library, shortcut: "G L", description: "Shared folders, templates, clause bank and knowledge" },
];

export const SECONDARY_NAV: NavItem[] = [{ label: "Settings", href: "/settings", icon: Settings, shortcut: "G ,", description: "AI, research providers, data integrity and the review queue" }];

/** "G" chord targets: key → href (shared by the shell and the palette so both stay in sync). */
export const GO_CHORD: Record<string, string> = { h: "/", s: "/search", e: "/ediscovery", w: "/workflows", o: "/office", l: "/library", ",": "/settings" };
