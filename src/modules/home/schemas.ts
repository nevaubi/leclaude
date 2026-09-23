import { z } from "zod";

const isoDate = z.string().min(4).max(40);
const link = z.object({ label: z.string().min(1).max(200), href: z.string().min(1).max(2000) });

export const taskCreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(5000).optional(),
  matterId: z.string().max(80).nullable().optional(),
  assigneeId: z.string().max(80).nullable().optional(),
  createdById: z.string().max(80).optional(),
  status: z.enum(["todo", "in_progress", "review", "done"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  dueAt: isoDate.nullable().optional(),
  tags: z.array(z.string().max(60)).max(20).optional(),
  source: z.enum(["manual", "workflow", "agent", "docket"]).optional(),
  links: z.array(link).max(20).optional(),
});

export const taskPatchSchema = taskCreateSchema.partial();

export const eventCreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  matterId: z.string().max(80).nullable().optional(),
  startsAt: isoDate,
  endsAt: isoDate.nullable().optional(),
  allDay: z.boolean().optional(),
  kind: z.enum(["deadline", "hearing", "deposition", "meeting", "filing", "internal", "cle", "other"]).optional(),
  location: z.string().max(300).nullable().optional(),
  attendeeIds: z.array(z.string().max(80)).max(50).optional(),
  notes: z.string().max(5000).nullable().optional(),
  ruleSource: z.string().max(300).nullable().optional(),
});

export const eventPatchSchema = eventCreateSchema.partial();

export const deadlineSchema = z.object({
  trigger: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.number().int().min(0).max(3660),
  direction: z.enum(["forward", "backward"]).optional(),
  method: z.enum(["frcp6a", "calendar", "court"]).optional(),
  addMailDays: z.boolean().optional(),
  extraHolidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(50).optional(),
});

export const updateCreateSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  kind: z.enum(["update", "win", "announcement", "question"]).optional(),
  matterId: z.string().max(80).nullable().optional(),
  attachments: z.array(link).max(10).optional(),
});

export const reactionSchema = z.object({ emoji: z.string().min(1).max(8) });
export const replySchema = z.object({ body: z.string().trim().min(1).max(2000) });
