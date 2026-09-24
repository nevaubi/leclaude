/** Pure form-state builders for the task and event dialogs (client-safe, unit-tested). */
import type { CalendarEvent, Task } from "@/lib/types/domain";
import { dateKey, DATE_ONLY_RE, localIso, toDate } from "./time";
import type { CalendarEntry, EventInput, TaskInput } from "./types";

export interface TaskForm { title: string; description: string; matterId: string; assigneeId: string; status: Task["status"]; priority: Task["priority"]; dueAt: string; tags: string; links: { label: string; href: string }[] }

/** Initial task-dialog state: an existing task wins over the caller's prefill; new tasks default to the active matter and the current user. */
export function taskFormFor(existing: Task | null, initial: Partial<TaskInput> | null, ctx: { userId: string; matterFilter: string | null }): TaskForm {
  const src = existing ?? initial;
  return { title: src?.title ?? "", description: src?.description ?? "", matterId: src?.matterId ?? ctx.matterFilter ?? "", assigneeId: src?.assigneeId ?? ctx.userId, status: src?.status ?? "todo", priority: src?.priority ?? "medium", dueAt: src?.dueAt ?? "", tags: (src?.tags ?? []).join(", "), links: src?.links ?? [] };
}

export interface EventForm { title: string; kind: CalendarEvent["kind"]; matterId: string; date: string; start: string; end: string; allDay: boolean; location: string; attendeeIds: string[]; notes: string; ruleSource: string }

/** Initial event-dialog state: splits startsAt/endsAt into date + HH:MM fields and detects all-day (date-only) entries. */
export function eventFormFor(e: CalendarEntry | null, initial: Partial<EventInput> | null, now: Date): EventForm {
  const src = e ?? initial;
  const startsAt = src?.startsAt ?? localIso(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10));
  const s = toDate(startsAt);
  const en = src?.endsAt ? toDate(src.endsAt) : new Date(s.getTime() + 3600_000);
  const allDay = src?.allDay ?? DATE_ONLY_RE.test(startsAt);
  const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return { title: src?.title ?? "", kind: src?.kind ?? "meeting", matterId: src?.matterId ?? "", date: dateKey(s), start: allDay ? "10:00" : hhmm(s), end: allDay ? "11:00" : hhmm(en), allDay, location: src?.location ?? "", attendeeIds: src?.attendeeIds ?? [], notes: src?.notes ?? "", ruleSource: src?.ruleSource ?? "" };
}
