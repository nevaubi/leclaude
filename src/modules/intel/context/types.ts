/**
 * Client-safe shapes for the personal, team and matter context the
 * intelligence layer builds for Home, matter headers and the agents.
 */
import type { CalendarEvent, Matter, Person, Task } from "@/lib/types/domain";
import type { IntelDocumentKind, IntelInsight, IntelWatch } from "../types";
import type { DocLite } from "../analysis/types";

export interface ContextPerson { id: string; name: string; title?: string; role: Person["role"]; organization?: string }

export interface ContextMatter {
  id: string;
  shortName: string;
  name: string;
  caption?: string;
  client: string;
  status: Matter["status"];
  stage?: string;
  court?: string;
  judge?: string;
  practiceArea: Matter["practiceArea"];
  leadAttorneyId?: string;
  teamIds: string[];
  keyDates: { label: string; date: string; daysUntil: number }[];
  /** Intelligence records linked to the matter. */
  records: number;
  recentRecords: number;
  /** Resolved entities on the matter (judge, MDL, court) when known. */
  entities: { judgeId?: string; mdlId?: string; courtId?: string };
}

export interface ContextEvent { id: string; title: string; matterId?: string; startsAt: string; endsAt?: string; kind: CalendarEvent["kind"]; location?: string; daysUntil: number }
export interface ContextTask { id: string; title: string; matterId?: string; status: Task["status"]; priority: Task["priority"]; dueAt?: string; overdue: boolean }

/** Recent docket and regulatory activity on a matter (for Home's "Matter watch"). */
export interface MatterActivity {
  matterId: string;
  shortName: string;
  docket: DocLite[];
  regulatory: DocLite[];
  other: DocLite[];
  total: number;
  /** Most recent record date. */
  lastAt?: string;
}

/** An upcoming event with the insights and records that help prepare for it. */
export interface UpcomingPrep {
  event: ContextEvent;
  matter?: { id: string; shortName: string };
  insights: IntelInsight[];
  records: DocLite[];
}

export interface UserContext {
  userId: string;
  user: ContextPerson;
  team: ContextPerson[];
  matters: ContextMatter[];
  calendar: ContextEvent[];
  tasks: ContextTask[];
  watches: IntelWatch[];
  recentResearch: { id: string; title: string; matterId: string | null; updatedAt: string; messages: number }[];
  recentDocs: { id: string; title: string; kind: string; matterId?: string; updatedAt: string; href: string }[];
  insights: IntelInsight[];
  matterActivity: MatterActivity[];
  upcoming: UpcomingPrep[];
  generatedAt: string;
  horizonDays: number;
}

export interface MatterContext {
  matter: ContextMatter;
  team: ContextPerson[];
  judge?: { id: string; name: string; detail?: string };
  court?: { id: string; name: string };
  mdl?: { id: string; name: string; detail?: string };
  activity: MatterActivity;
  chronology: { at: string; title: string; kind?: string; confidence: number }[];
  insights: IntelInsight[];
  watches: IntelWatch[];
  calendar: ContextEvent[];
  tasks: ContextTask[];
  byKind: Partial<Record<IntelDocumentKind, number>>;
  generatedAt: string;
}
