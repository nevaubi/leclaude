"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { NAV, SECONDARY_NAV } from "./nav";
import { useShellStore } from "./shell-store";
import { useTheme } from "./theme-provider";
import { FilePlus2, FileSpreadsheet, Presentation, Sparkles, Briefcase, FileText, Users, Calendar, ListTodo, Workflow, Sun, Moon, Monitor, ShieldCheck, ShieldAlert, PanelLeft } from "lucide-react";
import { debounce } from "@/lib/utils";

export interface QuickSearchHit {
  id: string;
  kind: "matter" | "document" | "person" | "task" | "event" | "workflow" | "library" | "office";
  title: string;
  subtitle?: string;
  href: string;
}

const KIND_ICON = { matter: Briefcase, document: FileText, person: Users, task: ListTodo, event: Calendar, workflow: Workflow, library: FileText, office: FileText } as const;
const KIND_LABEL: Record<QuickSearchHit["kind"], string> = { matter: "Matter", document: "Document", person: "Person", task: "Task", event: "Event", workflow: "Workflow", library: "Library", office: "Office" };

/** Group hits by kind so a mixed result list reads as sections, matters first. */
export function groupHits(hits: QuickSearchHit[]): { kind: QuickSearchHit["kind"]; label: string; hits: QuickSearchHit[] }[] {
  const order: QuickSearchHit["kind"][] = ["matter", "document", "office", "library", "person", "task", "event", "workflow"];
  const by = new Map<QuickSearchHit["kind"], QuickSearchHit[]>();
  for (const h of hits) by.set(h.kind, [...(by.get(h.kind) ?? []), h]);
  return order.filter((k) => by.has(k)).map((k) => ({ kind: k, label: KIND_LABEL[k] + (by.get(k)!.length === 1 ? "" : "s"), hits: by.get(k)! }));
}

export function CommandPalette() {
  const router = useRouter();
  const { paletteOpen, setPaletteOpen, toggleSidebar } = useShellStore();
  const { setTheme } = useTheme();
  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<QuickSearchHit[]>([]);
  const [loading, setLoading] = React.useState(false);

  const search = React.useMemo(
    () =>
      debounce(async (q: string) => {
        if (!q.trim()) { setHits([]); return; }
        setLoading(true);
        try {
          const res = await fetch(`/api/quick-search?q=${encodeURIComponent(q)}`);
          if (res.ok) setHits(((await res.json()) as { hits: QuickSearchHit[] }).hits ?? []);
        } catch { /* offline */ } finally { setLoading(false); }
      }, 120),
    [],
  );

  React.useEffect(() => { search(query); }, [query, search]);
  React.useEffect(() => { if (!paletteOpen) { setQuery(""); setHits([]); } }, [paletteOpen]);

  const go = (href: string) => { setPaletteOpen(false); router.push(href); };
  const groups = groupHits(hits);

  return (
    <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
      <CommandInput placeholder="Search matters, documents, people… or type a command" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>{loading ? "Searching…" : "No results."}</CommandEmpty>
        {groups.map((g) => (
          <CommandGroup key={g.kind} heading={g.label}>
            {g.hits.map((h) => { const Icon = KIND_ICON[h.kind] ?? FileText; return (
              <CommandItem key={`${h.kind}:${h.id}`} value={`${h.title} ${h.subtitle ?? ""} ${h.kind}`} onSelect={() => go(h.href)}>
                <Icon className="text-muted-foreground" />
                <span className="truncate">{h.title}</span>
                {h.subtitle && <span className="ml-2 truncate text-xs text-muted-foreground">{h.subtitle}</span>}
              </CommandItem>
            ); })}
          </CommandGroup>
        ))}
        <CommandGroup heading="Create">
          <CommandItem onSelect={() => go("/office/word/new")}><FilePlus2 /> New document<CommandShortcut>Word</CommandShortcut></CommandItem>
          <CommandItem onSelect={() => go("/office/sheet/new")}><FileSpreadsheet /> New workbook<CommandShortcut>Excel</CommandShortcut></CommandItem>
          <CommandItem onSelect={() => go("/office/slides/new")}><Presentation /> New deck<CommandShortcut>PowerPoint</CommandShortcut></CommandItem>
          <CommandItem onSelect={() => go(`/search?q=${encodeURIComponent(query)}`)}><Sparkles /> Ask the research agent{query ? `: “${query}”` : ""}</CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Go to">
          {[...NAV, ...SECONDARY_NAV].map((n) => (
            <CommandItem key={n.href} onSelect={() => go(n.href)}><n.icon /> {n.label}{n.shortcut && <CommandShortcut>{n.shortcut}</CommandShortcut>}</CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Integrity">
          <CommandItem onSelect={() => go("/settings#review")}><ShieldAlert /> Open the AI review queue</CommandItem>
          <CommandItem onSelect={() => go("/settings#integrity")}><ShieldCheck /> Data integrity scans and audit log</CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Preferences">
          <CommandItem onSelect={() => { setTheme("light"); setPaletteOpen(false); }}><Sun /> Light theme</CommandItem>
          <CommandItem onSelect={() => { setTheme("dark"); setPaletteOpen(false); }}><Moon /> Dark theme</CommandItem>
          <CommandItem onSelect={() => { setTheme("system"); setPaletteOpen(false); }}><Monitor /> System theme</CommandItem>
          <CommandItem onSelect={() => { toggleSidebar(); setPaletteOpen(false); }}><PanelLeft /> Toggle navigation labels<CommandShortcut>[</CommandShortcut></CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
