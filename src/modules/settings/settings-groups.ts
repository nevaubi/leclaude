/** Settings sections in page order (pure; shared by the nav, the page and tests). */
export interface SettingsGroup { id: "ai" | "research" | "data" | "integrity" | "about"; label: string; anchors?: string[] }

export const SETTINGS_GROUPS: SettingsGroup[] = [
  { id: "ai", label: "AI" },
  { id: "research", label: "Research providers" },
  { id: "data", label: "Data & automation", anchors: ["sources", "jobs"] },
  { id: "integrity", label: "Integrity", anchors: ["review", "scans", "audit"] },
  { id: "about", label: "About" },
];

/** Section id for a location hash (#review → integrity); undefined when unknown. */
export function sectionForHash(hash: string): SettingsGroup["id"] | undefined {
  const h = hash.replace(/^#/, "");
  return SETTINGS_GROUPS.find((g) => g.id === h || g.anchors?.includes(h))?.id;
}
