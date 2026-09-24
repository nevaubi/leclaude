"use client";
/**
 * Shared chrome for the four office editors: the quiet header row (portaled
 * into the app shell's top bar), the decluttered toolbar primitives, the
 * tracked-changes strip, segmented controls, right-panel tabs and the status
 * bar. Editors compose these so Word, Excel, PowerPoint and PDF read as one
 * product: one accent, thin borders, 8px rhythm, 13px UI text, tokens only.
 *
 * The pure helpers at the bottom (save labels, kind metadata, provenance
 * extraction, audit payloads) are unit-tested in tests/office-chrome.test.ts.
 */
import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Briefcase, Check, ChevronDown, ChevronLeft, ChevronRight, Download, FileSpreadsheet, FileText, FileType, Loader2, MoreHorizontal, Presentation, RotateCcw, Save, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Matter, OfficeKind } from "@/lib/types/domain";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/misc";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TopbarSlot } from "@/components/shell/app-shell";
import { KIND_BADGE, NARROW_VIEWPORT, downloadItemsToEntries, modKeyFor, saveButtonLabel, saveTone, savedAtLabel, type ChromeMenuEntry, type ChromeSaveState, type DownloadItem, type IconLike } from "./office-chrome-helpers";

export * from "./office-chrome-helpers";


// ---------------------------------------------------------------------------
// Kind metadata
// ---------------------------------------------------------------------------

export const KIND_CHROME: Record<OfficeKind, { badge: string; icon: LucideIcon; color: string; noun: string; plural: string; downloadLabel: string; placeholder: string }> = {
  word: { badge: KIND_BADGE.word, icon: FileText, color: "text-chart-1", noun: "document", plural: "documents", downloadLabel: "Download", placeholder: "Untitled document" },
  sheet: { badge: KIND_BADGE.sheet, icon: FileSpreadsheet, color: "text-chart-4", noun: "workbook", plural: "workbooks", downloadLabel: "Export", placeholder: "Untitled workbook" },
  slides: { badge: KIND_BADGE.slides, icon: Presentation, color: "text-chart-3", noun: "deck", plural: "decks", downloadLabel: "Download", placeholder: "Untitled deck" },
  pdf: { badge: KIND_BADGE.pdf, icon: FileType, color: "text-destructive", noun: "PDF", plural: "PDFs", downloadLabel: "Download", placeholder: "Untitled PDF" },
};

export function KindBadge({ kind, className }: { kind: OfficeKind; className?: string }) {
  const meta = KIND_CHROME[kind];
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-md border bg-background px-1.5 font-mono text-[10.5px] font-medium tracking-wide text-muted-foreground", className)} aria-label={`${meta.badge} ${meta.noun}`}>
      <Icon className={cn("size-3", meta.color)} />
      {meta.badge}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Header (portaled into the shell's top bar)
// ---------------------------------------------------------------------------

export interface ChromePanelToggle { id: string; label: string; icon: IconLike; active: boolean; onToggle: () => void; shortcut?: string; count?: number }

export interface OfficeChromeProps {
  kind: OfficeKind;
  title: string;
  onTitleChange: (v: string) => void;
  onTitleCommit: () => void | Promise<void>;
  matter?: Matter | null;
  matters?: Matter[];
  onMatterChange?: (id: string) => void;
  saveState: ChromeSaveState;
  lastSavedAt: Date | null;
  onSave: () => void;
  /** Editors disable most actions until the document is loaded. */
  ready?: boolean;
  /** Download/Export menu: a flat list of entries, or `{ items, busy }` (DownloadItem shape). */
  download?: ChromeMenuEntry[] | { items: DownloadItem[]; busy?: boolean; label?: string };
  downloadLabel?: string;
  exporting?: boolean;
  /** Placeholder for the title field (defaults to "Untitled <noun>"). */
  titlePlaceholder?: string;
  /** Extra header controls (toggles, version history…) rendered before Download. */
  tools?: React.ReactNode;
  /** Overflow menu (version history, page operations, shortcuts…). */
  more?: ChromeMenuEntry[];
  /** Right-hand panel toggles (comments, assistant…). Icon-only, with counts. */
  panels?: ChromePanelToggle[];
  /** Optional extra primary action rendered before Download (e.g. Present). */
  primary?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
}

function MenuEntries({ entries }: { entries: ChromeMenuEntry[] }) {
  return (
    <>
      {entries.map((e, i) => {
        if (e === "separator") return <DropdownMenuSeparator key={`sep-${i}`} />;
        if ("heading" in e) return <DropdownMenuLabel key={`h-${i}`}>{e.heading}</DropdownMenuLabel>;
        const Icon = e.icon;
        const inner = (
          <>
            {Icon && <Icon />}
            <span className="min-w-0 flex-1 truncate">{e.label}</span>
            {e.shortcut && <kbd className="ml-auto">{e.shortcut}</kbd>}
            {!e.shortcut && e.hint && <span className="ml-auto text-[10.5px] text-muted-foreground">{e.hint}</span>}
          </>
        );
        if (e.href) return <DropdownMenuItem key={i} asChild disabled={e.disabled}><a href={e.href} download={e.download}>{inner}</a></DropdownMenuItem>;
        return <DropdownMenuItem key={i} onClick={e.onSelect} disabled={e.disabled} destructive={e.destructive}>{inner}</DropdownMenuItem>;
      })}
    </>
  );
}

export function OfficeChrome(props: OfficeChromeProps) {
  const { kind, title, onTitleChange, onTitleCommit, matter, matters, onMatterChange, saveState, lastSavedAt, onSave, ready = true, downloadLabel, exporting, more, panels, primary, tools, titlePlaceholder, backHref = "/library", backLabel = "Library" } = props;
  const meta = KIND_CHROME[kind];
  const tone = saveTone(saveState);
  const download = Array.isArray(props.download) ? props.download : props.download ? downloadItemsToEntries(props.download.items) : undefined;
  const busy = exporting ?? (Array.isArray(props.download) ? false : props.download?.busy);
  const dlLabel = downloadLabel ?? (Array.isArray(props.download) ? undefined : props.download?.label) ?? meta.downloadLabel;
  return (
    <TopbarSlot>
      <Tip label={`Back to ${backLabel}`} shortcut="G L">
        <Link href={backHref} className="flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><ArrowLeft className="size-3.5" /> <span className="hidden sm:inline">{backLabel}</span></Link>
      </Tip>
      <KindBadge kind={kind} />
      {matters && onMatterChange && (matter || ready) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={cn("hidden h-6 max-w-[140px] shrink-0 xl:max-w-[180px] items-center gap-1 truncate rounded-md border px-2 text-[11.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:flex cursor-pointer", !matter && "border-dashed")} aria-label={matter ? `Matter: ${matter.shortName}` : "Link a matter"}>
              <Briefcase className="size-3" /><span className="truncate">{matter ? matter.shortName : "Link matter"}</span><ChevronDown className="size-3 opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel>Matter</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={matter?.id ?? ""} onValueChange={onMatterChange}>
              {matters.map((mm) => <DropdownMenuRadioItem key={mm.id} value={mm.id}><span className="truncate">{mm.shortName} <span className="text-muted-foreground">· {mm.client}</span></span></DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <input
        data-title-input="1"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        onBlur={() => void onTitleCommit()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
        aria-label={`${meta.noun[0].toUpperCase()}${meta.noun.slice(1)} title`}
        placeholder={titlePlaceholder ?? meta.placeholder}
        disabled={!ready}
        className="h-7 min-w-[7.5rem] flex-1 rounded-md border border-transparent bg-transparent px-2 text-[13px] font-semibold outline-none transition-colors hover:border-border focus:border-ring focus:bg-background disabled:opacity-70"
      />
      <span className={cn("hidden shrink-0 text-[11.5px] tabular xl:inline", tone === "destructive" ? "text-destructive" : tone === "warning" ? "text-warning-foreground dark:text-warning" : "text-muted-foreground")} aria-live="polite">{savedAtLabel(saveState, lastSavedAt)}</span>
      <div className="flex shrink-0 items-center gap-0.5">
        {panels?.map((p) => (
          <Tip key={p.id} label={p.label} shortcut={p.shortcut}>
            <Button variant={p.active ? "secondary" : "ghost"} size="icon-sm" onClick={p.onToggle} aria-pressed={p.active} aria-label={p.label} className="relative">
              <p.icon className={cn("size-4", p.active && "text-primary")} />
              {p.count ? <span className="absolute -right-0.5 -top-0.5 rounded-full bg-primary px-1 text-[9px] leading-3 text-primary-foreground tabular">{p.count}</span> : null}
            </Button>
          </Tip>
        ))}
        {tools}
        {primary}
        {download && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="gap-1.5" disabled={!ready} aria-label={dlLabel}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}<span className="hidden lg:inline">{dlLabel}</span><ChevronDown className="size-3 opacity-60" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72"><MenuEntries entries={download} /></DropdownMenuContent>
          </DropdownMenu>
        )}
        {more && more.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" disabled={!ready} aria-label="More"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72"><MenuEntries entries={more} /></DropdownMenuContent>
          </DropdownMenu>
        )}
        <Tip label={saveState === "error" ? "Save failed — retry" : "Save now"} shortcut="⌘S">
          <Button size="sm" variant={saveState === "error" ? "destructive" : "default"} onClick={onSave} disabled={!ready || saveState === "saving"} className="min-w-[64px]">
            {saveState === "saving" ? <Loader2 className="size-3.5 animate-spin" /> : saveState === "error" ? <RotateCcw className="size-3.5" /> : saveState === "dirty" ? <Save className="size-3.5" /> : <Check className="size-3.5" />}
            {saveButtonLabel(saveState)}
          </Button>
        </Tip>
      </div>
    </TopbarSlot>
  );
}

/** Error page for a missing/unreadable document, with a way back. */
export function OfficeErrorState({ kind, error, description }: { kind: OfficeKind; error: string; description?: string }) {
  const meta = KIND_CHROME[kind];
  return (
    <div className="flex h-full items-center justify-center p-6">
      <TopbarSlot>
        <Link href="/library" className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Back to Library</Link>
        <KindBadge kind={kind} />
      </TopbarSlot>
      <EmptyState icon={AlertTriangle} title={error} description={description ?? `The ${meta.noun} may have been deleted, or the link is wrong.`} action={<Button asChild variant="outline" size="sm"><Link href={`/office?kind=${kind}`}>Open {meta.plural}</Link></Button>} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar primitives
// ---------------------------------------------------------------------------

/** The editor's second row. Scrolls horizontally (without a scrollbar) instead of overflowing the page at narrow widths. */
export function OfficeToolbar({ children, className, disabled, right }: { children: React.ReactNode; className?: string; disabled?: boolean; right?: React.ReactNode }) {
  return (
    <div role="toolbar" aria-label="Editor toolbar" className={cn("office-toolbar flex h-10 shrink-0 items-center gap-0.5 overflow-x-auto border-b bg-background px-2 no-scrollbar", disabled && "pointer-events-none opacity-60", className)}>
      {children}
      {right && <><div className="min-w-2 flex-1" /><div className="flex shrink-0 items-center gap-0.5">{right}</div></>}
    </div>
  );
}

export function ToolbarSkeleton({ widths = [24, 24, 96, 88, 56, 24, 24, 24, 24, 72] }: { widths?: number[] }) {
  return <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">{widths.map((w, i) => <Skeleton key={i} className="h-6" style={{ width: w }} />)}</div>;
}

export const ToolSep = () => <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />;

export const TOOL_BTN = "inline-flex h-7 min-w-7 shrink-0 items-center justify-center gap-1 rounded-md px-1 text-[12.5px] text-foreground/80 transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 cursor-pointer";
export const TOOL_BTN_ACTIVE = "bg-accent text-accent-foreground";

export interface ToolButtonProps { icon?: IconLike; label: string; shortcut?: string; active?: boolean; onClick: () => void; disabled?: boolean; children?: React.ReactNode; className?: string; keepFocus?: boolean }

/** Icon (or icon + text) toolbar button. `keepFocus` (default true) keeps the editor selection by preventing mousedown focus. */
export function ToolButton({ icon: Icon, label, shortcut, active, onClick, disabled, children, className, keepFocus = true }: ToolButtonProps) {
  return (
    <Tip label={label} shortcut={shortcut}>
      <button type="button" onMouseDown={keepFocus ? (e) => e.preventDefault() : undefined} onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={active} data-state={active ? "on" : "off"} className={cn(TOOL_BTN, active && TOOL_BTN_ACTIVE, className)}>
        {Icon && <Icon className="size-4" />}
        {children}
      </button>
    </Tip>
  );
}

/** Text + chevron trigger used for the grouped menus (Style, Font, Size, Page, Insert…). Wrap in a DropdownMenuTrigger / PopoverTrigger with asChild. */
export const ToolMenuTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: IconLike; label: React.ReactNode; active?: boolean; width?: number; hideLabelBelow?: "lg" | "xl" }>(
  ({ icon: Icon, label, active, className, width, hideLabelBelow, ...rest }, ref) => (
    <button ref={ref} type="button" onMouseDown={(e) => e.preventDefault()} data-state={active ? "on" : "off"} className={cn(TOOL_BTN, "px-1.5", active && TOOL_BTN_ACTIVE, className)} style={width ? { width } : undefined} {...rest}>
      {Icon && <Icon className="size-4" />}
      <span className={cn("min-w-0 truncate font-normal", hideLabelBelow === "lg" && "hidden lg:inline", hideLabelBelow === "xl" && "hidden xl:inline")}>{label}</span>
      <ChevronDown className="size-3 shrink-0 opacity-60" />
    </button>
  ),
);
ToolMenuTrigger.displayName = "ToolMenuTrigger";

// ---------------------------------------------------------------------------
// Tracked changes strip (Word) — only mounted when there are changes.
// ---------------------------------------------------------------------------

export interface TrackedChangesStripProps {
  count: number;
  index: number;
  /** Step to the previous/next change. Either `onNav` or `onPrev` + `onNext`. */
  onNav?: (dir: -1 | 1) => void;
  onPrev?: () => void;
  onNext?: () => void;
  onAcceptCurrent: () => void;
  onRejectCurrent: () => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  /** Distinct change authors, shown quietly after the count. */
  authors?: string[];
  disabled?: boolean;
}

export function TrackedChangesStrip({ count, index, onNav, onPrev, onNext, onAcceptCurrent, onRejectCurrent, onAcceptAll, onRejectAll, authors, disabled }: TrackedChangesStripProps) {
  if (count <= 0) return null;
  const prev = () => (onPrev ? onPrev() : onNav?.(-1));
  const next = () => (onNext ? onNext() : onNav?.(1));
  return (
    <div className={cn("flex h-8 shrink-0 items-center gap-1 border-b bg-muted/30 px-3 text-[12px]", disabled && "pointer-events-none opacity-60")} role="region" aria-label="Tracked changes">
      <span className="tabular font-medium">{count} tracked change{count === 1 ? "" : "s"}</span>
      {authors && authors.length > 0 && <span className="hidden truncate text-muted-foreground lg:inline" title={authors.join(", ")}>· {authors.length === 1 ? authors[0] : `${authors.length} authors`}</span>}
      <span className="mx-1 h-4 w-px bg-border" />
      <Tip label="Previous change"><button type="button" onClick={prev} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer" aria-label="Previous change"><ChevronLeft className="size-3.5" /></button></Tip>
      <span className="min-w-[36px] text-center tabular text-muted-foreground">{Math.min(index + 1, count)}/{count}</span>
      <Tip label="Next change"><button type="button" onClick={next} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer" aria-label="Next change"><ChevronRight className="size-3.5" /></button></Tip>
      <span className="mx-1 h-4 w-px bg-border" />
      <Tip label="Accept this change"><button type="button" onClick={onAcceptCurrent} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-success hover:bg-success/10 cursor-pointer" aria-label="Accept current change"><Check className="size-3.5" /> Accept</button></Tip>
      <Tip label="Reject this change"><button type="button" onClick={onRejectCurrent} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-destructive hover:bg-destructive/10 cursor-pointer" aria-label="Reject current change"><X className="size-3.5" /> Reject</button></Tip>
      <div className="flex-1" />
      <button type="button" onClick={onAcceptAll} className="rounded px-2 py-0.5 font-medium hover:bg-accent cursor-pointer">Accept all</button>
      <button type="button" onClick={onRejectAll} className="rounded px-2 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer">Reject all</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Segmented control, panel tabs, status bar
// ---------------------------------------------------------------------------

export interface SegmentOption<T extends string> { id: T; label: React.ReactNode; icon?: IconLike; title?: string; shortcut?: string }

export function SegmentedControl<T extends string>({ options, value, onChange, className, size = "sm", ariaLabel, grow, "aria-label": ariaLabelAttr }: { options: SegmentOption<T>[]; value: T; onChange: (v: T) => void; className?: string; size?: "xs" | "sm"; ariaLabel?: string; "aria-label"?: string; grow?: boolean }) {
  return (
    <div role="tablist" aria-label={ariaLabel ?? ariaLabelAttr} className={cn("inline-flex shrink-0 items-center rounded-md bg-muted p-0.5", size === "sm" ? "h-8" : "h-7", grow && "flex w-full", className)}>
      {options.map((o) => {
        const active = o.id === value;
        const btn = (
          <button key={o.id} role="tab" aria-selected={active} onClick={() => onChange(o.id)} className={cn("inline-flex h-full items-center justify-center gap-1.5 rounded-[5px] px-2.5 font-medium transition-colors cursor-pointer", size === "sm" ? "text-[12.5px]" : "text-[12px]", grow && "flex-1", active ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}>
            {o.icon && <o.icon className="size-3.5" />}{o.label}
          </button>
        );
        return o.title || o.shortcut ? <Tip key={o.id} label={o.title ?? String(o.label)} shortcut={o.shortcut}>{btn}</Tip> : btn;
      })}
    </div>
  );
}

export interface PanelTab<T extends string> { id: T; label: string; icon?: IconLike; count?: number; shortcut?: string; hint?: string }

/**
 * Underlined tab strip for right-hand panels (Assistant | Comments (2) | Charts | Page Setup).
 * The strip is a container: in a narrow panel the icons drop first, then the padding tightens, so
 * four labelled tabs plus the close button always fit without truncating the last label.
 */
export function PanelTabs<T extends string>({ tabs, value, onChange, onClose, className, compact }: { tabs: PanelTab<T>[]; value: T | null; onChange: (t: T) => void; onClose?: () => void; className?: string; compact?: boolean }) {
  return (
    <div role="tablist" className={cn("@container flex h-9 shrink-0 items-center border-b px-1", className)}>
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button key={t.id} role="tab" aria-selected={active} onClick={() => onChange(t.id)} title={t.hint ?? (t.shortcut ? `${t.label} (${t.shortcut})` : t.label)} className={cn("relative flex h-full min-w-0 items-center gap-1.5 whitespace-nowrap text-[12.5px] font-medium transition-colors cursor-pointer", compact ? "px-2" : "px-1.5 @min-[440px]:px-2.5", active ? "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary" : "text-muted-foreground hover:text-foreground")}>
            {t.icon && <t.icon className={cn("size-3.5 shrink-0", !compact && "hidden @min-[480px]:inline")} />}
            <span className="truncate">{t.label}</span>
            {t.count ? <span className={cn("rounded-full px-1.5 text-[10.5px] tabular", active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{t.count}</span> : null}
          </button>
        );
      })}
      {onClose && <><div className="min-w-1 flex-1" /><button onClick={onClose} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer" aria-label="Close panel"><X className="size-3.5" /></button></>}
    </div>
  );
}

export function OfficeStatusBar({ children, right, className }: { children: React.ReactNode; right?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex h-7 shrink-0 items-center overflow-hidden border-t bg-background text-[11.5px] text-muted-foreground", className)} role="status">
      <div className="flex min-w-0 flex-1 items-center divide-x overflow-hidden">{children}</div>
      {right && <div className="flex shrink-0 items-center divide-x">{right}</div>}
    </div>
  );
}

export function StatusItem({ children, className, title, onClick, hide, active }: { children: React.ReactNode; className?: string; title?: string; onClick?: () => void; hide?: "md" | "lg" | "xl"; active?: boolean }) {
  const cls = cn("flex h-7 items-center gap-1 whitespace-nowrap px-2.5", hide === "md" && "hidden md:flex", hide === "lg" && "hidden lg:flex", hide === "xl" && "hidden xl:flex", onClick && "hover:bg-accent hover:text-foreground cursor-pointer", active && "text-primary", className);
  if (onClick) return <button type="button" title={title} onClick={onClick} aria-pressed={active} className={cls}>{children}</button>;
  return <span title={title} className={cls}>{children}</span>;
}

export const StatusSpacer = () => <span className="min-w-2 flex-1" aria-hidden />;

// ---------------------------------------------------------------------------
// Compatibility aliases (earlier chrome API names). Keep stable.
// ---------------------------------------------------------------------------

export const saveStateTone = saveTone;
export const headerSaveLabel = savedAtLabel;
export const ToolbarSep = ToolSep;
export const ToolbarSpacer = () => <span className="min-w-2 flex-1" aria-hidden />;
export type ToolbarButtonProps = ToolButtonProps & { text?: React.ReactNode; iconClassName?: string };
/** ToolButton with an optional text label (earlier name). */
export function ToolbarButton({ text, iconClassName, icon: Icon, children, className, ...rest }: ToolbarButtonProps) {
  return (
    <ToolButton {...rest} className={cn(text != null && "px-1.5", className)}>
      {Icon && <Icon className={cn("size-4", iconClassName)} />}
      {text != null && <span className="text-[12.5px]">{text}</span>}
      {children}
    </ToolButton>
  );
}
export const ToolbarMenuButton = React.forwardRef<HTMLButtonElement, React.ComponentProps<typeof ToolMenuTrigger> & { hideLabel?: boolean }>(({ hideLabel, hideLabelBelow, ...rest }, ref) => <ToolMenuTrigger ref={ref} hideLabelBelow={hideLabel ? "xl" : hideLabelBelow} {...rest} />);
ToolbarMenuButton.displayName = "ToolbarMenuButton";

// ---------------------------------------------------------------------------
// Additive helpers shared by the Sheet / Slides / PDF editors and the office
// home (appended; everything above is the base API the Word editor uses).
// ---------------------------------------------------------------------------

// Pure label/platform helpers (kindBadgeLabel, trackedChangesLabel, changePositionLabel, pluralize,
// rowRangeLabel, pageOfLabel, modKeyFor, shortcutFor, NARROW_VIEWPORT) live in ./office-chrome-helpers
// so vitest can import them without JSX; they are re-exported above.

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

/** Icon toggle for a header or toolbar right cluster (assistant, comments, panel…), with an optional count. */
export function ChromeToggle({ icon: Icon, label, shortcut, pressed, onClick, count, className, disabled }: { icon: LucideIcon; label: string; shortcut?: string; pressed: boolean; onClick: () => void; count?: number; className?: string; disabled?: boolean }) {
  return (
    <Tip label={label} shortcut={shortcut}>
      <Button variant={pressed ? "secondary" : "ghost"} size="icon-sm" onClick={onClick} aria-pressed={pressed} aria-label={label} className={cn("relative", className)} disabled={disabled}>
        <Icon className={cn("size-4", pressed && "text-primary")} />
        {count ? <span className="absolute -right-0.5 -top-0.5 min-w-[14px] rounded-full bg-primary px-1 text-center text-[9px] leading-[14px] text-primary-foreground tabular">{count > 99 ? "99+" : count}</span> : null}
      </Button>
    </Tip>
  );
}

/** Labelled on/off toolbar control ("Page breaks", "Track changes"). */
export function ToolbarToggle({ icon: Icon, label, shortcut, pressed, onClick, text, className }: { icon: LucideIcon; label: string; shortcut?: string; pressed: boolean; onClick: () => void; text?: React.ReactNode; className?: string }) {
  return (
    <Tip label={label} shortcut={shortcut}>
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} aria-pressed={pressed} aria-label={label} className={cn("inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[12px] transition-colors cursor-pointer", pressed ? "border-primary/40 bg-primary/10 text-primary" : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground", className)}>
        <Icon className="size-3.5" />
        {text ?? label}
      </button>
    </Tip>
  );
}

/** Flexible gap for toolbars. */
export const ToolSpacer = () => <span className="min-w-2 flex-1" aria-hidden />;

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

/** Empty / loading placeholder for side panels. */
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

/** Icon-only tab strip for narrow panels (PDF sidebar): tooltips carry the labels, counts sit as small badges. */
export function IconPanelTabs<T extends string>({ tabs, value, onChange, onClose, className }: { tabs: PanelTab<T>[]; value: T | null; onChange: (t: T) => void; onClose?: () => void; className?: string }) {
  return (
    <div role="tablist" className={cn("flex h-9 shrink-0 items-center gap-0.5 border-b bg-background px-1", className)}>
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <Tip key={t.id} label={t.count ? `${t.label} (${t.count})` : t.label} shortcut={t.shortcut}>
            <button role="tab" aria-selected={active} aria-label={t.label} onClick={() => onChange(t.id)} className={cn("relative flex h-7 flex-1 items-center justify-center rounded-md transition-colors cursor-pointer", active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {t.icon && <t.icon className="size-4" />}
              {t.count ? <span className="absolute -top-0.5 right-0.5 min-w-[14px] rounded-full bg-primary px-1 text-center text-[9px] leading-[14px] text-primary-foreground tabular">{t.count > 99 ? "99+" : t.count}</span> : null}
            </button>
          </Tip>
        );
      })}
      {onClose && <button onClick={onClose} className="ml-0.5 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer" aria-label="Close panel"><X className="size-3.5" /></button>}
    </div>
  );
}
