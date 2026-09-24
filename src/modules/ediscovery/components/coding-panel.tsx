"use client";
import * as React from "react";
import { Check, CircleCheck, CircleX, Flame, Loader2, Plus, Save, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tip } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { CodingDecision } from "@/lib/types/domain";
import { CONFIDENTIALITY_LEVELS, PRIVILEGE_BASES } from "../types";
import { useReviewStore } from "./store";
import { useReview } from "./review-page";
import { IssueChip, Kbd, issueColorClasses } from "./shared";

/**
 * Coding panel. The primary decisions (Responsive / Not / Privileged / Hot / Save & next)
 * sit in one sticky row at the top so the reviewer never scrolls to decide; the
 * detail fields (basis, confidentiality, issue codes, notes, reviewer) follow.
 */
export function CodingPanel({ draft, onChange, onSave, saving, dirty, reviewedBy, reviewedAt, className, width = 272 }: { draft: CodingDecision; onChange: (c: CodingDecision) => void; onSave: () => void; saving: boolean; dirty: boolean; reviewedBy?: string; reviewedAt?: string; className?: string; width?: number }) {
  const { issueCodes, reviewers, currentUserId } = useReview();
  const autoAdvance = useReviewStore((s) => s.autoAdvance);
  const setAutoAdvance = useReviewStore((s) => s.setAutoAdvance);
  const set = (patch: Partial<CodingDecision>) => onChange({ ...draft, ...patch });
  const issues = draft.issues ?? [];
  const [issueOpen, setIssueOpen] = React.useState(false);
  const togglePriv = () => set({ privileged: !draft.privileged, privilegeBasis: draft.privileged ? undefined : (draft.privilegeBasis ?? "attorney-client") });

  return (
    <aside className={cn("flex shrink-0 flex-col border-l bg-card/50", className)} style={{ width }} aria-label="Coding panel">
      {/* Primary actions: one sticky row */}
      <div className="sticky-actions shrink-0 border-b px-2 py-2">
        <div className="grid grid-cols-4 gap-1" role="group" aria-label="Primary coding">
          <Tip label="Responsive" shortcut="R"><Action active={draft.responsive === true} onClick={() => set({ responsive: draft.responsive === true ? null : true })} tone="success" icon={CircleCheck} label="Resp." /></Tip>
          <Tip label="Not responsive" shortcut="N"><Action active={draft.responsive === false} onClick={() => set({ responsive: draft.responsive === false ? null : false })} tone="muted" icon={CircleX} label="Not" /></Tip>
          <Tip label="Privileged" shortcut="P"><Action active={!!draft.privileged} onClick={togglePriv} tone="info" icon={ShieldAlert} label="Priv." /></Tip>
          <Tip label="Hot document" shortcut="H"><Action active={!!draft.hot} onClick={() => set({ hot: !draft.hot })} tone="destructive" icon={Flame} label="Hot" /></Tip>
        </div>
        <Button className="mt-1.5 w-full" size="sm" onClick={onSave} disabled={saving} variant={dirty ? "default" : "secondary"} aria-keyshortcuts="Meta+S Control+S">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} {dirty ? (autoAdvance ? "Save & next" : "Save coding") : "Saved"} <span className="ml-auto flex items-center gap-0.5 opacity-70"><Kbd>⌘</Kbd><Kbd>S</Kbd></span>
        </Button>
        {draft.responsive == null && <div className="mt-1 text-center text-[10.5px] text-warning-foreground dark:text-warning">No responsiveness decision yet</div>}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto scrollbar-thin p-3">
        {draft.privileged && (
          <Field label="Privilege basis">
            <Select value={draft.privilegeBasis ?? "attorney-client"} onValueChange={(v) => set({ privilegeBasis: v as CodingDecision["privilegeBasis"] })}>
              <SelectTrigger size="sm" aria-label="Privilege basis"><SelectValue /></SelectTrigger>
              <SelectContent>{PRIVILEGE_BASES.map((b) => <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        )}

        <Field label="Confidentiality">
          <Select value={draft.confidentiality ?? "none"} onValueChange={(v) => set({ confidentiality: v === "none" ? undefined : (v as CodingDecision["confidentiality"]) })}>
            <SelectTrigger size="sm" aria-label="Confidentiality"><SelectValue placeholder="Not designated" /></SelectTrigger>
            <SelectContent><SelectItem value="none">Not designated</SelectItem>{CONFIDENTIALITY_LEVELS.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent>
          </Select>
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
      <div className="flex shrink-0 items-center justify-between border-t px-3 py-2">
        <Label htmlFor="auto-advance" className="text-[11px] text-muted-foreground">Auto-advance after save</Label>
        <Switch id="auto-advance" checked={autoAdvance} onCheckedChange={setAutoAdvance} size="sm" />
      </div>
    </aside>
  );
}

function Action({ active, onClick, tone, icon: Icon, label }: { active: boolean; onClick: () => void; tone: "success" | "muted" | "info" | "destructive"; icon: React.ComponentType<{ className?: string }>; label: string }) {
  const on = { success: "border-success/40 bg-success/12 text-success", muted: "border-foreground/25 bg-muted text-foreground", info: "border-info/40 bg-info/12 text-info", destructive: "border-destructive/40 bg-destructive/12 text-destructive" }[tone];
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cn("flex h-11 flex-col items-center justify-center gap-0.5 rounded-md border text-[10.5px] font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50", active ? on : "border-border text-muted-foreground hover:bg-accent hover:text-foreground")}>
      <Icon className="size-4" />
      {label}
    </button>
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
