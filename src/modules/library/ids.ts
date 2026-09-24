import { MATTERS } from "@/lib/seed/ids";

/** Stable ids for the system folders. Safe to import from client components. */
export const LIBRARY_FOLDERS = {
  firm: "lib_folder_firm",
  matters: "lib_folder_matters",
  templates: "lib_folder_templates",
  clauses: "lib_folder_clauses",
  knowledge: "lib_folder_knowledge",
  myFiles: "lib_folder_myfiles",
} as const;

/** Folder created by the Home module for saved news items; shown alongside the system folders. */
export const NEWS_CLIPPINGS_FOLDER = "lib_folder_news_clippings";

/** Knowledge base subfolders (seeded by the library module); other seeds file items here instead of the Knowledge root. */
export const KNOWLEDGE_SUBFOLDERS = {
  litigation: "lib_folder_knowledge_litigation",
  transactional: "lib_folder_knowledge_transactional",
  research: "lib_folder_knowledge_research",
  style: "lib_folder_knowledge_style",
} as const;

export const SYSTEM_FOLDER_ORDER: string[] = [LIBRARY_FOLDERS.firm, LIBRARY_FOLDERS.matters, LIBRARY_FOLDERS.templates, LIBRARY_FOLDERS.clauses, LIBRARY_FOLDERS.knowledge, LIBRARY_FOLDERS.myFiles];

export function matterFolderId(matterId: string) {
  return `lib_folder_matter_${matterId}`;
}

export function isMatterFolderId(id: string) {
  return id.startsWith("lib_folder_matter_");
}

export function matterIdFromFolderId(id: string): string | null {
  return isMatterFolderId(id) ? id.slice("lib_folder_matter_".length) : null;
}

export const SYSTEM_FOLDER_IDS = new Set<string>([...SYSTEM_FOLDER_ORDER, NEWS_CLIPPINGS_FOLDER, ...Object.values(MATTERS).map(matterFolderId)]);

export function isSystemFolder(id: string) {
  return SYSTEM_FOLDER_IDS.has(id) || isMatterFolderId(id);
}

/** Current user (the platform runs single-user in this build). */
export const LIBRARY_USER = { id: "p_jwhitfield", name: "Jordan Whitfield" } as const;
