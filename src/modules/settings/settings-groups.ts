/** Settings sections in page order (pure; shared by the nav, the page and tests). */
export interface SettingsGroup { id: "workspace" | "team" | "ai" | "research" | "data" | "integrity" | "about"; label: string; anchors?: string[] }

/** The firm: its profile and its people. Shown first, above the system configuration. */
export const WORKSPACE_GROUPS: SettingsGroup[] = [
  { id: "workspace", label: "Workspace" },
  { id: "team", label: "Team" },
];

/** System configuration read from the environment and the automation state. */
export const SETTINGS_GROUPS: SettingsGroup[] = [
  { id: "ai", label: "AI" },
  { id: "research", label: "Research providers" },
  { id: "data", label: "Data & automation", anchors: ["sources", "jobs"] },
  { id: "integrity", label: "Integrity", anchors: ["review", "scans", "audit"] },
  { id: "about", label: "About" },
];

/** Every section in page order. */
export const ALL_SETTINGS_GROUPS: SettingsGroup[] = [...WORKSPACE_GROUPS, ...SETTINGS_GROUPS];

/** Section id for a location hash (#review → integrity); undefined when unknown. */
export function sectionForHash(hash: string): SettingsGroup["id"] | undefined {
  const h = hash.replace(/^#/, "");
  return ALL_SETTINGS_GROUPS.find((g) => g.id === h || g.anchors?.includes(h))?.id;
}
