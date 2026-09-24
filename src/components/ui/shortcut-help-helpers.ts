/** Shortcut registry model for the `?` help dialog. Pure; unit-tested. */

export interface ShortcutItem { keys: string[]; label: string }
export interface ShortcutGroup { id: string; title: string; items: ShortcutItem[] }

/** Shortcuts the shell provides on every page. */
export const GLOBAL_SHORTCUTS: ShortcutGroup[] = [
  {
    id: "global",
    title: "Everywhere",
    items: [
      { keys: ["mod+k"], label: "Command palette" },
      { keys: ["?"], label: "Keyboard shortcuts" },
      { keys: ["/"], label: "Focus search" },
      { keys: ["["], label: "Toggle the navigation rail" },
      { keys: ["]"], label: "Toggle the right panel" },
      { keys: ["esc"], label: "Close panel or dialog" },
    ],
  },
  {
    id: "go",
    title: "Go to",
    items: [
      { keys: ["g", "h"], label: "Home" },
      { keys: ["g", "s"], label: "Search" },
      { keys: ["g", "i"], label: "Intelligence" },
      { keys: ["g", "e"], label: "E-Discovery" },
      { keys: ["g", "w"], label: "Workflows" },
      { keys: ["g", "o"], label: "Office" },
      { keys: ["g", "l"], label: "Library" },
      { keys: ["g", ","], label: "Settings" },
    ],
  },
  {
    id: "grid",
    title: "Tables and lists",
    items: [
      { keys: ["j"], label: "Next row" },
      { keys: ["k"], label: "Previous row" },
      { keys: ["home"], label: "First row" },
      { keys: ["end"], label: "Last row" },
      { keys: ["shift+↑↓"], label: "Extend selection" },
      { keys: ["mod+click"], label: "Toggle a row" },
      { keys: ["space"], label: "Select the active row" },
      { keys: ["enter"], label: "Open the active row" },
    ],
  },
];

/** Page groups override global groups with the same id; otherwise they are appended. */
export function mergeShortcutGroups(base: ShortcutGroup[], extra: ShortcutGroup[]): ShortcutGroup[] {
  const out = base.map((g) => ({ ...g, items: [...g.items] }));
  for (const g of extra) {
    const i = out.findIndex((x) => x.id === g.id);
    if (i >= 0) out[i] = { ...g, items: [...g.items] };
    else out.push({ ...g, items: [...g.items] });
  }
  return out.filter((g) => g.items.length > 0);
}

const NAMED: Record<string, string> = { esc: "Esc", enter: "↵", space: "Space", home: "Home", end: "End", tab: "Tab", up: "↑", down: "↓", left: "←", right: "→", backspace: "⌫", delete: "Del", click: "Click" };

/** "mod+k" → "⌘K" (mac) / "Ctrl K"; single letters upper-case; chords stay separate: ["g","h"] → ["G","H"]. */
export function formatKeys(keys: string[], platform: "mac" | "other" = "mac"): string[] {
  const mod = platform === "mac" ? "⌘" : "Ctrl";
  const shift = platform === "mac" ? "⇧" : "Shift";
  const alt = platform === "mac" ? "⌥" : "Alt";
  return keys.map((k) => {
    const parts = k.split("+").map((p) => p.trim()).filter(Boolean);
    const rendered = parts.map((p) => {
      const lower = p.toLowerCase();
      if (lower === "mod" || lower === "cmd" || lower === "meta") return mod;
      if (lower === "shift") return shift;
      if (lower === "alt" || lower === "option") return alt;
      if (NAMED[lower]) return NAMED[lower];
      return p.length === 1 ? p.toUpperCase() : p;
    });
    return rendered.join(platform === "mac" ? "" : " ");
  });
}

/** True when a key event originates in a text field (shortcuts must not fire). */
export function isTypingTarget(target: { tagName?: string; isContentEditable?: boolean; closest?: (sel: string) => unknown } | null | undefined): boolean {
  if (!target) return false;
  const tag = (target.tagName ?? "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

export function detectPlatform(userAgent: string | undefined): "mac" | "other" {
  return /mac|iphone|ipad/i.test(userAgent ?? "") ? "mac" : "other";
}
