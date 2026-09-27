/**
 * Pure builders for the workspace half of the Apple antitrust demo pack: matters, team, parties, tasks, calendar,
 * team updates and library content. Office document content lives in ./office (server-only: it uses the editors'
 * builders). The loader in src/modules/demo/index.ts writes all of it.
 */
import type { CalendarEvent, Deposition, LibraryItem, Task, TeamUpdate } from "@/lib/types/domain";
import type { DemoBuildContext } from "./context";
import { buildDemoEvents, buildDemoTasks, buildDemoUpdates } from "./home";
import { buildDemoFolders, buildDemoLibraryItems } from "./library";
import { buildDemoMatters, type DemoMatter } from "./matters";
import { buildDemoParties, buildDemoTeam, type DemoPerson } from "./people";

export * from "./context";
export { DEMO_FOLDERS } from "./library";
export { DEMO_CASE_NUMBER, DEMO_CONSUMER_NAME, DEMO_CONSUMER_NUMBER, DEMO_DOJ_NUMBER, type DemoMatter } from "./matters";
export { DEMO_JUDGE, DEMO_OPPOSING_COUNSEL, DEMO_TEAM_PROFILES, type DemoPerson } from "./people";

export interface DemoWorkspace {
  matters: DemoMatter[];
  team: DemoPerson[];
  parties: DemoPerson[];
  tasks: Task[];
  events: CalendarEvent[];
  updates: TeamUpdate[];
  folders: LibraryItem[];
  libraryItems: LibraryItem[];
}

export function buildDemoWorkspace(ctx: DemoBuildContext, opts: { takenEmails?: ReadonlySet<string>; depositions?: Pick<Deposition, "id" | "witnessId" | "witnessName" | "date" | "location">[] } = {}): DemoWorkspace {
  const matters = buildDemoMatters(ctx);
  return {
    matters,
    team: buildDemoTeam(ctx, opts.takenEmails),
    parties: buildDemoParties(),
    tasks: buildDemoTasks(ctx),
    events: buildDemoEvents(ctx, opts.depositions ?? []),
    updates: buildDemoUpdates(ctx),
    folders: buildDemoFolders(ctx, matters),
    libraryItems: buildDemoLibraryItems(ctx),
  };
}
