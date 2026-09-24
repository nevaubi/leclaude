"use client";
import * as React from "react";
import { Check, Flame, Loader2, Plus, Save, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { CodingDecision } from "@/lib/types/domain";
import { CONFIDENTIALITY_LEVELS, PRIVILEGE_BASES } from "../types";
import { useReviewStore } from "./store";
import { useReview } from "./review-page";
import { IssueChip, Kbd, issueColorClasses } from "./shared";

export function CodingPanel({ draft, onChange, onSave, saving, dirty, reviewedBy, reviewedAt }: { draft: CodingDecision; onChange: (c: CodingDecision) => void; onSave: () => void; saving: boolean; dirty: boolean; reviewedBy?: string; reviewedAt?: string }) {
  const { issueCodes, reviewers, currentUserId } = useReview();
  const autoAdvance = useReviewStore((s) => s.autoAdvance);
  const setAutoAdvance = useReviewStore((s) => s.setAutoAdvance);
  const set = (patch: Partial<CodingDecision>) => onChange({ ...draft, ...patch });
  const issues = draft.issues ?? [];
  const [issueOpen, setIssueOpen] = React.useState(false);

  return (
    <aside className="flex w-[264px] shrink-0 flex-col border-l bg-card/50" aria-label="Coding panel">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto scrollbar-thin p-3">
        <Field label="Responsive" shortcut="R / N">
          <div className="grid grid-cols-2 gap-1 rounded-md border p-0.5" role="radiogroup" aria-label="Responsive">
            <Seg active={draft.responsive === true} onClick={() => set({ responsive: draft.responsive === true ? null : true })} className="data-[on=true]:bg-success/15 data-[on=true]:text-success">Yes</Seg>
            <Seg active={draft.responsive === false} onClick={() => set({ responsive: draft.responsive === false ? null : false })}>No</Seg>
          </div>
          {draft.responsive == null && <div className="mt-1 text-[10.5px] text-warning-foreground dark:text-warning">Needs review</div>}
        </Field>

        <Field label="Privileged" shortcut="P">
          <div className="flex items-center justify-between rounded-md border px-2.5 py-1.5">
            <span className="flex items-center gap-1.5 text-xs"><ShieldAlert className={cn("size-3.5", draft.privileged ? "text-info" : "text-muted-foreground")} />Withhold as privileged</span>
            <Switch checked={!!draft.privileged} onCheckedChange={(v) => set({ privileged: v, privilegeBasis: v ? (draft.privilegeBasis ?? "attorney-client") : undefined })} aria-label="Privileged" />
          </div>
          {draft.privileged && (
            <Select value={draft.privilegeBasis ?? "attorney-client"} onValueChange={(v) => set({ privilegeBasis: v as CodingDecision["privilegeBasis"] })}>
              <SelectTrigger size="sm" className="mt-1.5" aria-label="Privilege basis"><SelectValue /></SelectTrigger>
              <SelectContent>{PRIVILEGE_BASES.map((b) => <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </Field>

        <Field label="Confidentiality">
          <Select value={draft.confidentiality ?? "none"} onValueChange={(v) => set({ confidentiality: v === "none" ? undefined : (v as CodingDecision["confidentiality"]) })}>
            <SelectTrigger size="sm" aria-label="Confidentiality"><SelectValue placeholder="Not designated" /></SelectTrigger>
            <SelectContent><SelectItem value="none">Not designated</SelectItem>{CONFIDENTIALITY_LEVELS.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>

        <Field label="Hot" shortcut="H">
          <button onClick={() => set({ hot: !draft.hot })} className={cn("flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-xs transition-colors cursor-pointer", draft.hot ? "border-destructive/40 bg-destructive/10 text-destructive" : "hover:bg-accent")} aria-pressed={!!draft.hot}>
            <span className="flex items-center gap-1.5"><Flame className="size-3.5" />Hot document</span>
            {draft.hot && <Check className="size-3.5" />}
          </button>
        </Field>

        <Field label="Issue codes">
          <div className="flex flex-wrap gap-1">
            {issues.map((c) => <IssueChip key={c} code={c} codes={issueCodes} onRemove={() => set({ issues: issues.filter((x) => x !== c) })} />)}
            <Popover open={issueOpen} onOpenChange={setIssueOpen}>
              <PopoverTrigger asChild><Button variant="outline" size="xs" className="h-[22px] gap-1 px-1.5 text-[11px]"><Plus className="size-3" /> Add</Button></PopoverTrigger>
              <PopoverContent align="start" className="w-72 p-0">
                <Command>
                  <CommandInput placeholder="Search issue codes…" className="h-9 text-xs" />
                  <CommandList>
                    <CommandEmpty>No codes.</CommandEmpty>
                    <CommandGroup>
                      {issueCodes.map((c) => {
                        const on = issues.includes(c.code);
                        return (
                          <CommandItem key={c.id} value={`${c.code} ${c.label}`} onSelect={() => set({ issues: on ? issues.filter((x) => x !== c.code) : [...issues, c.code] })} className="text-xs">
                            <span className={cn("size-1.5 rounded-full", issueColorClasses(c.color).dot)} />
                            <span className="font-mono">{c.code}</span>
                            <span className="min-w-0 flex-1 truncate text-muted-foreground">{c.label}</span>
                            {on && <Check className="size-3.5" />}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        </Field>

        <Field label="Notes">
          <Textarea value={draft.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} placeholder="Reviewer notes, second-level flags, privilege reasoning…" className="min-h-[88px] text-xs" />
        </Field>

        <Field label="Reviewer">
          <Select value={draft.reviewerId ?? currentUserId} onValueChange={(v) => set({ reviewerId: v })}>
            <SelectTrigger size="sm" aria-label="Reviewer"><SelectValue /></SelectTrigger>
            <SelectContent>{reviewers.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
          </Select>
          {reviewedBy && reviewedAt && <div className="mt-1 text-[10.5px] text-muted-foreground">Last coded by {reviewedBy} · {new Date(reviewedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>}
        </Field>
      </div>
      <div className="shrink-0 space-y-2 border-t p-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="auto-advance" className="text-[11px] text-muted-foreground">Auto-advance after save</Label>
          <Switch id="auto-advance" checked={autoAdvance} onCheckedChange={setAutoAdvance} className="scale-90" />
        </div>
        <Button className="w-full" size="sm" onClick={onSave} disabled={saving} variant={dirty ? "default" : "secondary"}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} {dirty ? "Save coding" : "Saved"} <span className="ml-auto flex items-center gap-0.5 opacity-70"><Kbd>⌘</Kbd><Kbd>S</Kbd></span>
        </Button>
      </div>
    </aside>
  );
}

function Field({ label, shortcut, children }: { label: string; shortcut?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between"><span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>{shortcut && <span className="text-[10px] text-muted-foreground/70">{shortcut}</span>}</div>
      {children}
    </div>
  );
}

function Seg({ active, onClick, children, className }: { active: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button role="radio" aria-checked={active} data-on={active} onClick={onClick} className={cn("rounded px-2 py-1 text-xs font-medium transition-colors cursor-pointer", active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground", className)}>
      {children}
    </button>
  );
}
