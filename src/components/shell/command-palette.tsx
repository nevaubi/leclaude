"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { NAV } from "./nav";
import { useShellStore } from "./shell-store";
import { FilePlus2, FileSpreadsheet, Presentation, Sparkles, Briefcase, FileText, Users, Calendar, ListTodo, Workflow } from "lucide-react";
import { debounce } from "@/lib/utils";

export interface QuickSearchHit {
  id: string;
  kind: "matter" | "document" | "person" | "task" | "event" | "workflow" | "library" | "office";
  title: string;
  subtitle?: string;
  href: string;
}

const KIND_ICON = { matter: Briefcase, document: FileText, person: Users, task: ListTodo, event: Calendar, workflow: Workflow, library: FileText, office: FileText } as const;

export function CommandPalette() {
  const router = useRouter();
  const { paletteOpen, setPaletteOpen } = useShellStore();
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

  return (
    <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
      <CommandInput placeholder="Search matters, documents, people… or type a command" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>{loading ? "Searching…" : "No results."}</CommandEmpty>
        {hits.length > 0 && (
          <CommandGroup heading="Results">
            {hits.map((h) => { const Icon = KIND_ICON[h.kind] ?? FileText; return (
              <CommandItem key={`${h.kind}:${h.id}`} value={`${h.title} ${h.subtitle ?? ""} ${h.kind}`} onSelect={() => go(h.href)}>
                <Icon className="text-muted-foreground" />
                <span className="truncate">{h.title}</span>
                {h.subtitle && <span className="ml-2 truncate text-xs text-muted-foreground">{h.subtitle}</span>}
                <CommandShortcut className="capitalize tracking-normal">{h.kind}</CommandShortcut>
              </CommandItem>
            ); })}
          </CommandGroup>
        )}
        <CommandGroup heading="Create">
          <CommandItem onSelect={() => go("/office/word/new")}><FilePlus2 /> New document<CommandShortcut>Word</CommandShortcut></CommandItem>
          <CommandItem onSelect={() => go("/office/sheet/new")}><FileSpreadsheet /> New workbook<CommandShortcut>Excel</CommandShortcut></CommandItem>
          <CommandItem onSelect={() => go("/office/slides/new")}><Presentation /> New deck<CommandShortcut>PowerPoint</CommandShortcut></CommandItem>
          <CommandItem onSelect={() => go(`/search?q=${encodeURIComponent(query)}`)}><Sparkles /> Ask the research agent{query ? `: “${query}”` : ""}</CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Go to">
          {NAV.map((n) => (
            <CommandItem key={n.href} onSelect={() => go(n.href)}><n.icon /> {n.label}{n.shortcut && <CommandShortcut>{n.shortcut}</CommandShortcut>}</CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
