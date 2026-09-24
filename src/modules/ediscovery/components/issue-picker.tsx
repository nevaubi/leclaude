"use client";
import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { IssueCode } from "@/lib/types/domain";
import { issueColorClasses } from "./shared";

/**
 * Issue-code picker: a searchable list with the current codes checked. Used
 * inline in the grid, in the coding panel and in the bulk bar. Keyboard
 * shortcuts 1–9 map to the first nine codes in rubric order (shown as hints).
 */
export function IssuePicker({ codes, value, onChange, children, open, onOpenChange, align = "start", showKeys }: { codes: IssueCode[]; value: string[]; onChange: (next: string[]) => void; children: React.ReactElement; open?: boolean; onOpenChange?: (v: boolean) => void; align?: "start" | "end" | "center"; showKeys?: boolean }) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-72 p-0" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <Command>
          <CommandInput placeholder="Search issue codes…" className="h-8 text-xs" />
          <CommandList className="max-h-64">
            <CommandEmpty>No codes.</CommandEmpty>
            <CommandGroup>
              {codes.map((c, i) => {
                const on = value.includes(c.code);
                return (
                  <CommandItem key={c.id} value={`${c.code} ${c.label}`} onSelect={() => onChange(on ? value.filter((x) => x !== c.code) : [...value, c.code])} className="text-xs">
                    <span className={cn("size-1.5 shrink-0 rounded-full", issueColorClasses(c.color).dot)} />
                    <span className="font-mono">{c.code}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{c.label}</span>
                    {showKeys && i < 9 && <kbd className="px-1 text-[10px]">{i + 1}</kbd>}
                    {on && <Check className="size-3.5" />}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
