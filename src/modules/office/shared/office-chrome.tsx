"use client";
/**
 * Shared editor chrome for the office suite (Word, Excel, PowerPoint, PDF):
 *
 *  - <OfficeChrome>: the quiet top bar — "Library" back link, kind badge,
 *    matter chip, editable title; on the right the save state ("Saved 3:08 PM"),
 *    editor-specific toggles, a Download menu and the primary Save button.
 *  - <OfficeToolbar> + ToolbarButton/ToolbarMenu/ToolbarToggle/ToolbarSep: the
 *    second row, grouped into menus so the row stays calm at 1024px.
 *  - <TrackedChangesStrip>: one slim line under the toolbar, only when there
 *    are pending tracked changes.
 *  - <OfficeStatusBar> + <StatusItem>: the bottom line (words, pages, ¶ n of N…).
 *  - <PanelTabs>, <SegmentedControl>, <PanelHeader>: right/left panel chrome.
 *
 * Everything is token-driven (no hardcoded colors) so it renders in both themes.
 */
import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Briefcase, Check, ChevronDown, ChevronLeft, ChevronRight, Download, FileSpreadsheet, FileText, FileType, Loader2, Presentation, Save, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Matter, OfficeKind } from "@/lib/types/domain";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TopbarSlot } from "@/components/shell/app-shell";
import type { SaveState } from "./use-office-doc";
import { OFFICE_KIND_EXT } from "./types";

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in tests/office-chrome.test.ts)
// ---------------------------------------------------------------------------

/** Upper-case file-type badge for the header: DOCX / XLSX / PPTX / PDF. */
export function kindBadgeLabel(kind: OfficeKind): string {
  return OFFICE_KIND_EXT[kind].toUpperCase();
}

/** Primary button label: "Save" while there is unsaved work, "Saved" once the document is clean. */
export function saveButtonLabel(state: SaveState): "Save" | "Saved" | "Saving…" | "Retry save" {
  switch (state) {
    case "dirty": return "Save";
    case "saving": return "Saving…";
    case "error": return "Retry save";
    default: return "Saved";
  }
}

/** Visual tone for the save-state text. */
export function saveStateTone(state: SaveState): "muted" | "warning" | "destructive" {
  if (state === "error") return "destructive";
  if (state === "dirty") return "warning";
  return "muted";
}

/** "3:08 PM" style clock label used by the header ("Saved 3:08 PM"). */
export function formatClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Header save label: "Saved 3:08 PM", "Saving…", "Unsaved changes", "Save failed". */
export function headerSaveLabel(state: SaveState, lastSavedAt: Date | null): string {
  switch (state) {
    case "saving": return "Saving…";
    case "dirty": return "Unsaved changes";
    case "error": return "Save failed";
    case "saved": return lastSavedAt ? `Saved ${formatClock(lastSavedAt)}` : "Saved";
    default: return lastSavedAt ? `Saved ${formatClock(lastSavedAt)}` : "All changes saved";
  }
}

/** "5 tracked changes" / "1 tracked change" / "No tracked changes". */
export function trackedChangesLabel(count: number): string {
  if (count <= 0) return "No tracked changes";
  return `${count} tracked change${count === 1 ? "" : "s"}`;
}

/** "3 / 5" position label for the tracked-changes strip, or "–" when empty. */
export function changePositionLabel(index: number, count: number): string {
  if (count <= 0) return "–";
  const i = Math.max(0, Math.min(index, count - 1));
  return `${i + 1} / ${count}`;
}

export function pluralize(n: number, noun: string, plural = `${noun}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? noun : plural}`;
}

/** Platform modifier for shortcut hints. Defaults to ⌘ on the server; corrected after mount. */
export function modKeyFor(platform: string | undefined): "⌘" | "Ctrl" {
  return platform && /Win|Linux|Android|CrOS/i.test(platform) && !/Mac|iPhone|iPad/i.test(platform) ? "Ctrl" : "⌘";
}

/** Viewports narrower than this open editors with side panels collapsed. */
export const NARROW_VIEWPORT = 1180;

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** True when the viewport is narrower than `max` (false during SSR so wide layouts hydrate cleanly). */
export function useNarrowViewport(max = NARROW_VIEWPORT): boolean {
  const query = `(max-width: ${max - 1}px)`;
  const subscribe = React.useCallback((cb: () => void) => {
    if (typeof window === "undefined") return () => {};
    const mq = window.matchMedia(query);
    mq.addEventListener("change", cb);
    return () => mq.removeEventListener("change", cb);
  }, [query]);
  return React.useSyncExternalStore(subscribe, () => (typeof window === "undefined" ? false : window.matchMedia(query).matches), () => false);
}

/** "⌘" or "Ctrl" for shortcut hints, resolved after mount to avoid hydration drift. */
export function useModKey(): "⌘" | "Ctrl" {
  const [mod, setMod] = React.useState<"⌘" | "Ctrl">("⌘");
  React.useEffect(() => { setMod(modKeyFor(navigator.platform || navigator.userAgent)); }, []);
  return mod;
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

const KIND_ICON: Record<OfficeKind, LucideIcon> = { word: FileText, sheet: FileSpreadsheet, slides: Presentation, pdf: FileType };

export function KindBadge({ kind, className }: { kind: OfficeKind; className?: string }) {
  const Icon = KIND_ICON[kind];
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-md border bg-muted/40 px-1.5 font-mono text-[10.5px] font-medium tracking-wide text-muted-foreground", className)} title={`${kindBadgeLabel(kind)} document`}>
      <Icon className="size-3" />
      {kindBadgeLabel(kind)}
    </span>
  );
}

export interface DownloadItem {
  id: string;
  label: React.ReactNode;
  icon?: LucideIcon;
  shortcut?: string;
  hint?: string;
  onSelect?: () => void;
  /** Plain link download (e.g. the source PDF). */
  href?: string;
  downloadName?: string;
  separatorBefore?: boolean;
  disabled?: boolean;
}

export interface OfficeChromeProps {
  kind: OfficeKind;
  title: string;
  onTitleChange: (title: string) => void;
  onTitleCommit: () => void | Promise<void>;
  titlePlaceholder?: string;
  backHref?: string;
  backLabel?: string;
  matter?: Matter | null;
  matters?: Matter[];
  onMatterChange?: (matterId: string) => void;
  saveState: SaveState;
  lastSavedAt: Date | null;
  onSave: () => void;
  ready?: boolean;
  download?: { label?: string; items: DownloadItem[]; busy?: boolean };
  /** Icon toggles (panel, comments, assistant…) rendered between the save state and Download. */
  tools?: React.ReactNode;
  /** Extra action rendered before Download (e.g. Present, Pages menu). */
  extra?: React.ReactNode;
}

/**
 * The quiet top bar shared by every editor. Renders into the shell's top bar
 * slot so the page keeps a single header row.
 */
export function OfficeChrome(p: OfficeChromeProps) {
  const mod = useModKey();
  const label = headerSaveLabel(p.saveState, p.lastSavedAt);
  const tone = saveStateTone(p.saveState);
  const dirty = p.saveState === "dirty" || p.saveState === "error";
  return (
    <TopbarSlot>
      <Tip label={`Back to ${p.backLabel ?? "Library"}`} shortcut="G L">
        <Link href={p.backHref ?? "/library"} className="flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
          <ArrowLeft className="size-3.5" /> {p.backLabel ?? "Library"}
        </Link>
      </Tip>
      <KindBadge kind={p.kind} />
      {p.matters && p.onMatterChange && (p.matter || p.ready) && <MatterChip matter={p.matter ?? null} matters={p.matters} onChange={p.onMatterChange} />}
      <input
        data-title-input="1"
        value={p.title}
        onChange={(e) => p.onTitleChange(e.target.value)}
        onBlur={() => void p.onTitleCommit()}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } if (e.key === "Escape") (e.target as HTMLInputElement).blur(); }}
        aria-label="Document title"
        placeholder={p.titlePlaceholder ?? "Untitled"}
        spellCheck={false}
        className="h-7 min-w-[120px] flex-1 truncate rounded-md border border-transparent bg-transparent px-2 text-[13px] font-semibold outline-none transition-colors hover:border-border focus:border-ring focus:bg-background"
      />
      <span className={cn("hidden shrink-0 whitespace-nowrap text-[11.5px] tabular xl:inline", tone === "destructive" ? "text-destructive" : tone === "warning" ? "text-warning-foreground dark:text-warning" : "text-muted-foreground")} aria-live="polite">
        {p.saveState === "saving" && <Loader2 className="mr-1 inline size-3 animate-spin align-[-2px]" />}
        {label}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        {p.tools}
        {p.extra}
        {p.download && p.download.items.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5 px-2 text-[13px] font-medium" disabled={p.ready === false}>
                {p.download.busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                <span className="hidden sm:inline">{p.download.label ?? "Download"}</span>
                <ChevronDown className="size-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              {p.download.items.map((it) => {
                const Icon = it.icon;
                const body = (<>{Icon && <Icon />}<span className="min-w-0 flex-1 truncate">{it.label}</span>{it.shortcut && <span className="ml-auto text-[10px] text-muted-foreground">{it.shortcut.replace("⌘", mod === "Ctrl" ? "Ctrl+" : "⌘")}</span>}{it.hint && !it.shortcut && <span className="ml-auto text-[10px] text-muted-foreground">{it.hint}</span>}</>);
                return (
                  <React.Fragment key={it.id}>
                    {it.separatorBefore && <DropdownMenuSeparator />}
                    {it.href ? (
                      <DropdownMenuItem asChild disabled={it.disabled}><a href={it.href} download={it.downloadName}>{body}</a></DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onClick={it.onSelect} disabled={it.disabled}>{body}</DropdownMenuItem>
                    )}
                  </React.Fragment>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Tip label={dirty ? "Save now" : "Saved — press to save a fresh copy"} shortcut={`${mod}S`}>
          <Button variant={dirty ? "default" : "secondary"} size="sm" onClick={p.onSave} disabled={p.saveState === "saving" || p.ready === false} className="min-w-[72px] gap-1.5 text-[13px]" aria-label={saveButtonLabel(p.saveState)}>
            {p.saveState === "saving" ? <Loader2 className="size-3.5 animate-spin" /> : dirty ? <Save className="size-3.5" /> : <Check className="size-3.5" />}
            {saveButtonLabel(p.saveState)}
          </Button>
        </Tip>
      </div>
    </TopbarSlot>
  );
}

function MatterChip({ matter, matters, onChange }: { matter: Matter | null; matters: Matter[]; onChange: (id: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={cn("hidden h-6 max-w-[200px] shrink-0 items-center gap-1 truncate rounded-md border px-2 text-[11.5px] transition-colors hover:text-foreground lg:flex cursor-pointer", matter ? "text-muted-foreground" : "border-dashed text-muted-foreground")} aria-label={matter ? `Matter: ${matter.shortName}` : "Link a matter"}>
          <Briefcase className="size-3" />
          <span className="truncate">{matter ? matter.shortName : "Link matter"}</span>
          <ChevronDown className="size-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Matter</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={matter?.id ?? ""} onValueChange={onChange}>
          {matters.map((m) => (
            <DropdownMenuRadioItem key={m.id} value={m.id}>
              <span className="truncate">{m.shortName} <span className="text-muted-foreground">· {m.client}</span></span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Icon toggle for the header (assistant, comments, panel…). */
export function ChromeToggle({ icon: Icon, label, shortcut, pressed, onClick, count, className }: { icon: LucideIcon; label: string; shortcut?: string; pressed: boolean; onClick: () => void; count?: number; className?: string }) {
  return (
    <Tip label={label} shortcut={shortcut}>
      <Button variant={pressed ? "secondary" : "ghost"} size="icon-sm" onClick={onClick} aria-pressed={pressed} aria-label={label} className={cn("relative", className)}>
        <Icon className={cn("size-4", pressed && "text-primary")} />
        {count != null && count > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[14px] rounded-full bg-primary px-1 text-center text-[9px] leading-[14px] text-primary-foreground tabular">{count > 99 ? "99+" : count}</span>}
      </Button>
    </Tip>
  );
}

// ---------------------------------------------------------------------------
// Toolbar row
// ---------------------------------------------------------------------------

export function OfficeToolbar({ children, className, disabled, "aria-label": ariaLabel }: { children: React.ReactNode; className?: string; disabled?: boolean; "aria-label"?: string }) {
  return (
    <div role="toolbar" aria-label={ariaLabel ?? "Editor toolbar"} className={cn("office-toolbar flex h-10 shrink-0 items-center gap-0.5 overflow-x-auto border-b bg-background px-2 no-scrollbar", disabled && "pointer-events-none opacity-60", className)}>
      {children}
    </div>
  );
}

/** Skeleton for the toolbar while a document loads. */
export function ToolbarSkeleton({ widths = [24, 24, 96, 88, 56, 24, 24, 24, 24, 72, 72] }: { widths?: number[] }) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-1.5 border-b bg-background px-2">
      {widths.map((w, i) => <span key={i} className="h-6 shrink-0 animate-pulse rounded-md bg-muted" style={{ width: w }} />)}
    </div>
  );
}

export const ToolbarSep = () => <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />;
export const ToolbarSpacer = () => <span className="flex-1" aria-hidden />;

export interface ToolbarButtonProps {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  /** Show the label next to the icon. */
  text?: React.ReactNode;
  className?: string;
  iconClassName?: string;
}

/** Icon button for toolbars: keeps editor focus (mousedown prevented), tooltip with shortcut. */
export function ToolbarButton({ icon: Icon, label, shortcut, active, disabled, onClick, text, className, iconClassName }: ToolbarButtonProps) {
  return (
    <Tip label={label} shortcut={shortcut}>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active}
        data-state={active ? "on" : "off"}
        className={cn("inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md text-foreground/80 transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 cursor-pointer", text ? "px-1.5 text-xs" : "w-7", active && "bg-accent text-accent-foreground", className)}
      >
        <Icon className={cn("size-4", iconClassName)} />
        {text}
      </button>
    </Tip>
  );
}

/** Labelled dropdown trigger for toolbars ("Style ▾", "Insert ▾"). Wrap in <DropdownMenu>/<Popover> and pass asChild on the trigger. */
export const ToolbarMenuButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: LucideIcon; label: React.ReactNode; hideLabel?: boolean; active?: boolean; width?: number | string }>(
  ({ icon: Icon, label, hideLabel, active, width, className, ...rest }, ref) => (
    <button
      ref={ref}
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      data-state={active ? "on" : undefined}
      className={cn("inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-foreground/85 transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 cursor-pointer", active && "bg-accent text-accent-foreground", className)}
      style={width != null ? { width } : undefined}
      {...rest}
    >
      {Icon && <Icon className="size-4 shrink-0" />}
      <span className={cn("min-w-0 flex-1 truncate text-left", hideLabel && "sr-only")}>{label}</span>
      <ChevronDown className="size-3 shrink-0 opacity-60" />
    </button>
  ),
);
ToolbarMenuButton.displayName = "ToolbarMenuButton";

/** Labelled on/off control ("Track changes"). */
export function ToolbarToggle({ icon: Icon, label, shortcut, pressed, onClick, text }: { icon: LucideIcon; label: string; shortcut?: string; pressed: boolean; onClick: () => void; text?: React.ReactNode }) {
  return (
    <Tip label={label} shortcut={shortcut}>
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} aria-pressed={pressed} aria-label={label} className={cn("inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors cursor-pointer", pressed ? "border-primary/40 bg-primary/10 text-primary" : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground")}>
        <Icon className="size-3.5" />
        {text ?? label}
      </button>
    </Tip>
  );
}

// ---------------------------------------------------------------------------
// Tracked changes strip (Word) — one slim line, only when there are changes.
// ---------------------------------------------------------------------------

export interface TrackedChangesStripProps {
  count: number;
  index: number;
  onPrev: () => void;
  onNext: () => void;
  onAcceptCurrent: () => void;
  onRejectCurrent: () => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  /** Author names to show as quiet chips (max 3). */
  authors?: string[];
}

export function TrackedChangesStrip(p: TrackedChangesStripProps) {
  if (p.count <= 0) return null;
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b bg-muted/30 px-3 text-xs" role="region" aria-label="Tracked changes">
      <span className="font-medium tabular">{trackedChangesLabel(p.count)}</span>
      {p.authors && p.authors.length > 0 && <span className="hidden truncate text-muted-foreground md:inline">· {p.authors.slice(0, 3).join(", ")}{p.authors.length > 3 ? ` +${p.authors.length - 3}` : ""}</span>}
      <span className="mx-1 h-4 w-px bg-border" />
      <Tip label="Previous change"><button type="button" onClick={p.onPrev} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer" aria-label="Previous change"><ChevronLeft className="size-3.5" /></button></Tip>
      <span className="min-w-[44px] text-center tabular text-muted-foreground">{changePositionLabel(p.index, p.count)}</span>
      <Tip label="Next change"><button type="button" onClick={p.onNext} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer" aria-label="Next change"><ChevronRight className="size-3.5" /></button></Tip>
      <span className="mx-1 h-4 w-px bg-border" />
      <Tip label="Accept this change"><button type="button" onClick={p.onAcceptCurrent} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-success hover:bg-success/10 cursor-pointer" aria-label="Accept current change"><Check className="size-3.5" /> Accept</button></Tip>
      <Tip label="Reject this change"><button type="button" onClick={p.onRejectCurrent} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-destructive hover:bg-destructive/10 cursor-pointer" aria-label="Reject current change"><X className="size-3.5" /> Reject</button></Tip>
      <span className="flex-1" />
      <Button size="xs" variant="outline" onClick={p.onAcceptAll} className="h-6">Accept all</Button>
      <Button size="xs" variant="ghost" onClick={p.onRejectAll} className="h-6 text-muted-foreground">Reject all</Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

export function OfficeStatusBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("office-status flex h-8 shrink-0 items-center overflow-hidden border-t bg-background text-[11.5px] text-muted-foreground", className)} role="status" aria-label="Document status">
      {children}
    </div>
  );
}

export function StatusItem({ children, className, title, onClick, active }: { children: React.ReactNode; className?: string; title?: string; onClick?: () => void; active?: boolean }) {
  const cls = cn("flex h-full items-center gap-1 whitespace-nowrap border-r px-2.5 last:border-r-0", onClick && "hover:bg-accent hover:text-foreground cursor-pointer", active && "text-primary", className);
  if (onClick) return <button type="button" title={title} onClick={onClick} className={cls}>{children}</button>;
  return <span title={title} className={cls}>{children}</span>;
}

export const StatusSpacer = () => <span className="flex-1" aria-hidden />;

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

export interface PanelTab<T extends string> { id: T; label: string; icon?: LucideIcon; count?: number; hint?: string }

/** Underlined tab strip for right-hand panels: "Assistant | Comments (2) | Charts (1) | Page Setup". */
export function PanelTabs<T extends string>({ tabs, value, onChange, onClose, className, compact }: { tabs: PanelTab<T>[]; value: T | null; onChange: (t: T) => void; onClose?: () => void; className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex h-10 shrink-0 items-center border-b bg-background px-1", className)} role="tablist">
      {tabs.map((t) => {
        const active = t.id === value;
        const inner = (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            aria-label={t.label}
            onClick={() => onChange(t.id)}
            className={cn("relative flex h-full items-center gap-1.5 whitespace-nowrap px-2.5 text-[12.5px] font-medium transition-colors cursor-pointer", compact && "flex-1 justify-center px-1.5", active ? "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary" : "text-muted-foreground hover:text-foreground")}
          >
            {t.icon && <t.icon className="size-3.5" />}
            {!compact && t.label}
            {t.count != null && t.count > 0 && <span className={cn("rounded-full px-1.5 text-[10px] tabular", active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground", compact && "absolute -top-0.5 right-0")}>{t.count}</span>}
          </button>
        );
        return compact ? <Tip key={t.id} label={t.hint ?? t.label} side="left">{inner}</Tip> : inner;
      })}
      {onClose && (
        <>
          <span className="flex-1" />
          <Tip label="Close panel"><Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close panel"><X className="size-3.5" /></Button></Tip>
        </>
      )}
    </div>
  );
}

/** Two-to-four option segmented control ("Outline | Find", "Draft | Review | Ask"). */
export function SegmentedControl<T extends string>({ options, value, onChange, className, size = "sm", "aria-label": ariaLabel }: { options: { id: T; label: string; icon?: LucideIcon; shortcut?: string }[]; value: T; onChange: (v: T) => void; className?: string; size?: "sm" | "md"; "aria-label"?: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("inline-flex w-full items-center rounded-lg bg-muted p-0.5", className)}>
      {options.map((o) => {
        const active = o.id === value;
        const btn = (
          <button
            key={o.id}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.id)}
            className={cn("flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md font-medium transition-colors cursor-pointer", size === "sm" ? "h-7 px-2 text-xs" : "h-8 px-3 text-[13px]", active ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}
          >
            {o.icon && <o.icon className="size-3.5 shrink-0" />}
            <span className="truncate">{o.label}</span>
          </button>
        );
        return o.shortcut ? <Tip key={o.id} label={o.label} shortcut={o.shortcut}>{btn}</Tip> : btn;
      })}
    </div>
  );
}

/** Quiet panel header: icon, title, count, actions, close. */
export function PanelHeader({ icon: Icon, title, count, children, onClose, className }: { icon?: LucideIcon; title: string; count?: number | string; children?: React.ReactNode; onClose?: () => void; className?: string }) {
  return (
    <div className={cn("flex h-10 shrink-0 items-center gap-2 border-b px-3", className)}>
      {Icon && <Icon className="size-4 text-muted-foreground" />}
      <span className="truncate text-[13px] font-semibold">{title}</span>
      {count != null && <span className="text-[11px] tabular text-muted-foreground">{count}</span>}
      <span className="flex-1" />
      {children}
      {onClose && <Tip label="Close"><Button variant="ghost" size="icon-xs" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`}><X className="size-3.5" /></Button></Tip>}
    </div>
  );
}

/** Empty / loading placeholder for panels. */
export function PanelEmpty({ icon: Icon, title, description, action, className }: { icon?: LucideIcon; title: string; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-1.5 px-6 py-10 text-center", className)}>
      {Icon && <span className="mb-1 flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground"><Icon className="size-4" /></span>}
      <div className="text-[13px] font-medium">{title}</div>
      {description && <div className="max-w-[260px] text-xs leading-relaxed text-muted-foreground">{description}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
