import "server-only";
import { collection, Collection } from "./collections";
import { kv } from "./kv";
import { blobs } from "./blobs";
import { getSqlite, resetSqlite, dataDir } from "./sqlite";
import type {
  Person, Matter, Task, CalendarEvent, NewsItem, TeamUpdate, EDocument, Deposition, TimelineEvent, Relationship, Conflict, IssueCode, PrivilegeLogEntry, Workflow, WorkflowRun, OfficeDocument, OfficeVersion, OfficeComment, LibraryItem,
} from "@/lib/types/domain";
import { ensureSeeded } from "@/lib/seed";

/**
 * Typed handles for every shared collection. Call `db()` from server code
 * (route handlers, server components, tools). The first call seeds demo data
 * when the database is empty.
 */
export interface Database {
  people: Collection<Person>;
  matters: Collection<Matter>;
  tasks: Collection<Task>;
  events: Collection<CalendarEvent>;
  news: Collection<NewsItem>;
  updates: Collection<TeamUpdate>;
  edocs: Collection<EDocument>;
  depositions: Collection<Deposition>;
  timeline: Collection<TimelineEvent>;
  relationships: Collection<Relationship>;
  conflicts: Collection<Conflict>;
  issueCodes: Collection<IssueCode>;
  privilegeLog: Collection<PrivilegeLogEntry>;
  workflows: Collection<Workflow>;
  workflowRuns: Collection<WorkflowRun>;
  officeDocs: Collection<OfficeDocument>;
  officeVersions: Collection<OfficeVersion>;
  officeComments: Collection<OfficeComment>;
  library: Collection<LibraryItem>;
  kv: typeof kv;
  blobs: typeof blobs;
  /** Arbitrary module-private collection. */
  collection: typeof collection;
  raw: ReturnType<typeof getSqlite>;
}

let handle: Database | null = null;

export function db(): Database {
  if (!handle) {
    handle = {
      people: collection<Person>("people"),
      matters: collection<Matter>("matters"),
      tasks: collection<Task>("tasks"),
      events: collection<CalendarEvent>("events"),
      news: collection<NewsItem>("news"),
      updates: collection<TeamUpdate>("team_updates"),
      edocs: collection<EDocument>("ediscovery_documents"),
      depositions: collection<Deposition>("depositions"),
      timeline: collection<TimelineEvent>("timeline_events"),
      relationships: collection<Relationship>("relationships"),
      conflicts: collection<Conflict>("conflicts"),
      issueCodes: collection<IssueCode>("issue_codes"),
      privilegeLog: collection<PrivilegeLogEntry>("privilege_log"),
      workflows: collection<Workflow>("workflows"),
      workflowRuns: collection<WorkflowRun>("workflow_runs"),
      officeDocs: collection<OfficeDocument>("office_documents"),
      officeVersions: collection<OfficeVersion>("office_versions"),
      officeComments: collection<OfficeComment>("office_comments"),
      library: collection<LibraryItem>("library_items"),
      kv,
      blobs,
      collection,
      raw: getSqlite(),
    };
  }
  ensureSeeded(handle);
  return handle;
}

export { collection, kv, blobs, resetSqlite, dataDir };
export type { Collection };
