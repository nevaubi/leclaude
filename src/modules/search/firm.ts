import "server-only";
import { getWorkspace } from "@/lib/workspace";

/** The firm's name for prompts: the workspace record from setup (or NEXT_PUBLIC_FIRM_NAME), else a neutral "the firm". */
export function firmLabel(): string {
  try {
    const w = getWorkspace();
    if (w.configured || process.env.NEXT_PUBLIC_FIRM_NAME?.trim()) return w.firmName;
  } catch { /* storage unavailable: stay neutral */ }
  return "the firm";
}
