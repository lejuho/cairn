import { z } from "zod";

export const THREAD_STATUSES = ["active", "done", "paused", "dropped"] as const;
export const EVENT_STATUSES = [
  "planned",
  "confirmed",
  "done",
  "cancelled",
  "moved",
  "late"
] as const;
export const EVENT_SOURCES = ["gcal", "manual", "cairn"] as const;
export const TASK_STATUSES = ["todo", "doing", "done", "dropped"] as const;
export const LINK_FIRMNESSES = ["hard", "soft", "tentative"] as const;
export const LINK_SOURCES = ["given", "authored", "inferred"] as const;
export const LINK_KINDS = [
  "blocks",
  "requires",
  "triggers",
  "caused_by",
  "follows"
] as const;
export const THREAD_LINK_KINDS = [
  "contains",
  "blocks",
  "feeds",
  "competes",
  "shares"
] as const;
export const WATCHER_KINDS = ["A", "B"] as const;

export const ThreadStatusSchema = z.enum(THREAD_STATUSES);
export const EventStatusSchema = z.enum(EVENT_STATUSES);
export const EventSourceSchema = z.enum(EVENT_SOURCES);
export const TaskStatusSchema = z.enum(TASK_STATUSES);
export const LinkFirmnessSchema = z.enum(LINK_FIRMNESSES);
export const LinkSourceSchema = z.enum(LINK_SOURCES);
export const LinkKindSchema = z.enum(LINK_KINDS);
export const ThreadLinkKindSchema = z.enum(THREAD_LINK_KINDS);
export const WatcherKindSchema = z.enum(WATCHER_KINDS);

export type ThreadStatus = z.infer<typeof ThreadStatusSchema>;
export type EventStatus = z.infer<typeof EventStatusSchema>;
export type EventSource = z.infer<typeof EventSourceSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type LinkFirmness = z.infer<typeof LinkFirmnessSchema>;
export type LinkSource = z.infer<typeof LinkSourceSchema>;
export type LinkKind = z.infer<typeof LinkKindSchema>;
export type ThreadLinkKind = z.infer<typeof ThreadLinkKindSchema>;
export type WatcherKind = z.infer<typeof WatcherKindSchema>;
