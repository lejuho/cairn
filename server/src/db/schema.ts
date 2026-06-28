import { sql } from "drizzle-orm";
import {
  check,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex
} from "drizzle-orm/sqlite-core";

const THREAD_STATUSES = ["active", "done", "paused", "dropped"] as const;
const EVENT_STATUSES = [
  "planned",
  "confirmed",
  "done",
  "cancelled",
  "moved",
  "late"
] as const;
const EVENT_SOURCES = ["gcal", "manual", "cairn"] as const;
const EVENT_MODES = ["in_person", "remote", "async"] as const;
const TASK_STATUSES = ["todo", "doing", "done", "dropped"] as const;
const LINK_FIRMNESSES = ["hard", "soft", "tentative"] as const;
const LINK_SOURCES = ["given", "authored", "inferred"] as const;
const LINK_KINDS = ["blocks", "requires", "triggers", "caused_by", "follows"] as const;
const THREAD_LINK_KINDS = ["contains", "blocks", "feeds", "competes", "shares"] as const;
const WATCHER_KINDS = ["A", "B"] as const;
const WATCHER_LOG_OUTCOMES = ["checked_no_signal", "signal_seen", "missed_signal"] as const;
const RESOURCE_KINDS = ["item", "knowledge"] as const;
const RESOURCE_TARGET_TYPES = ["event", "task", "thread"] as const;
const RESOURCE_FIRMNESSES = ["hard", "soft", "tentative"] as const;

const enumSqlList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(", "));

export const threads = sqliteTable(
  "threads",
  {
    id: integer("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind"),
    goal: text("goal"),
    definitionOfDone: text("definition_of_done"),
    deadline: text("deadline"),
    status: text("status").default("active"),
    domain: text("domain").notNull().default("personal"),
    createdAt: text("created_at").default(sql`(datetime('now'))`),
    // Resume / CV STAR fields (cycle-56 FR-CV-01/03). Persisted, user-owned,
    // editable only on completed threads. skills_tags holds a JSON string array.
    resumeRelevant: integer("resume_relevant").default(0),
    starSituation: text("star_situation"),
    starAction: text("star_action"),
    starResult: text("star_result"),
    skillsTags: text("skills_tags")
  },
  (table) => [
    check("threads_status_check", sql`${table.status} in (${enumSqlList(THREAD_STATUSES)})`),
    check("threads_resume_relevant_check", sql`${table.resumeRelevant} in (0, 1)`),
    check("threads_domain_check", sql`${table.domain} in ('personal', 'work')`)
  ]
);

export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey(),
    threadId: integer("thread_id").references(() => threads.id),
    title: text("title").notNull(),
    type: text("type"),
    start: text("start"),
    end: text("end"),
    location: text("location"),
    mode: text("mode"),
    source: text("source"),
    selfImposed: integer("self_imposed").default(0),
    status: text("status").default("planned"),
    commitment: integer("commitment").default(2),
    reversible: integer("reversible").default(1),
    cancelMoney: integer("cancel_money").default(0),
    cancelSocial: integer("cancel_social").default(0),
    cancelEffort: text("cancel_effort").default("none"),
    cancelWindow: text("cancel_window"),
    refundCutoff: text("refund_cutoff"),
    schedulePromptDismissedOn: text("schedule_prompt_dismissed_on"),
    createdAt: text("created_at").default(sql`(datetime('now'))`),
    updatedAt: text("updated_at"),
    externalCalendarId: text("external_calendar_id"),
    externalEventId: text("external_event_id"),
    externalIcalUid: text("external_ical_uid"),
    externalEtag: text("external_etag"),
    externalUpdated: text("external_updated")
  },
  (table) => [
    check("events_source_check", sql`${table.source} in (${enumSqlList(EVENT_SOURCES)})`),
    check("events_mode_check", sql`${table.mode} is null or ${table.mode} in (${enumSqlList(EVENT_MODES)})`),
    check("events_self_imposed_check", sql`${table.selfImposed} in (0, 1)`),
    check("events_status_check", sql`${table.status} in (${enumSqlList(EVENT_STATUSES)})`),
    check("events_commitment_check", sql`${table.commitment} between 1 and 3`),
    check("events_reversible_check", sql`${table.reversible} in (0, 1)`),
    check("events_cancel_money_check", sql`${table.cancelMoney} >= 0`),
    check("events_cancel_social_check", sql`${table.cancelSocial} between 0 and 3`),
    uniqueIndex("events_external_identity_idx").on(
      table.externalCalendarId,
      table.externalEventId
    )
  ]
);

export const annotations = sqliteTable(
  "annotations",
  {
    id: integer("id").primaryKey(),
    eventId: integer("event_id").references(() => events.id),
    outcome: text("outcome"),
    reasonTags: text("reason_tags"),
    reasonText: text("reason_text"),
    energyAtTime: integer("energy_at_time"),
    loggedAt: text("logged_at").default(sql`(datetime('now'))`)
  },
  (table) => [
    check("annotations_outcome_check", sql`${table.outcome} in ('done', 'cancelled', 'moved', 'late')`),
    check("annotations_energy_at_time_check", sql`${table.energyAtTime} between 1 and 5`)
  ]
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: integer("id").primaryKey(),
    threadId: integer("thread_id").references(() => threads.id),
    title: text("title").notNull(),
    estMinutes: integer("est_minutes"),
    due: text("due"),
    context: text("context"),
    status: text("status").default("todo"),
    optional: integer("optional").default(0),
    schedulePromptDismissedOn: text("schedule_prompt_dismissed_on"),
    scheduledEventId: integer("scheduled_event_id").references(() => events.id),
    createdAt: text("created_at").default(sql`(datetime('now'))`)
  },
  (table) => [
    check("tasks_status_check", sql`${table.status} in (${enumSqlList(TASK_STATUSES)})`),
    check("tasks_optional_check", sql`${table.optional} in (0, 1)`)
  ]
);

export const links = sqliteTable(
  "links",
  {
    id: integer("id").primaryKey(),
    fromId: integer("from_id"),
    fromKind: text("from_kind"),
    toId: integer("to_id"),
    toKind: text("to_kind"),
    kind: text("kind"),
    firmness: text("firmness").default("soft"),
    source: text("source").default("inferred"),
    createdAt: text("created_at").default(sql`(datetime('now'))`)
  },
  (table) => [
    check("links_from_kind_check", sql`${table.fromKind} in ('event', 'task')`),
    check("links_to_kind_check", sql`${table.toKind} in ('event', 'task')`),
    check("links_kind_check", sql`${table.kind} in (${enumSqlList(LINK_KINDS)})`),
    check("links_firmness_check", sql`${table.firmness} in (${enumSqlList(LINK_FIRMNESSES)})`),
    check("links_source_check", sql`${table.source} in (${enumSqlList(LINK_SOURCES)})`),
    check(
      "links_inferred_not_hard_check",
      sql`not (${table.source} = 'inferred' and ${table.firmness} = 'hard')`
    )
  ]
);

export const threadLinks = sqliteTable(
  "thread_links",
  {
    id: integer("id").primaryKey(),
    fromThread: integer("from_thread").references(() => threads.id),
    toThread: integer("to_thread").references(() => threads.id),
    kind: text("kind"),
    firmness: text("firmness").default("soft"),
    createdAt: text("created_at").default(sql`(datetime('now'))`)
  },
  (table) => [
    check("thread_links_kind_check", sql`${table.kind} in (${enumSqlList(THREAD_LINK_KINDS)})`),
    check("thread_links_firmness_check", sql`${table.firmness} in ('hard', 'soft')`)
  ]
);

export const people = sqliteTable("people", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  relation: text("relation"),
  preferredWindows: text("preferred_windows"),
  hardConstraints: text("hard_constraints"),
  leadTime: text("lead_time"),
  channel: text("channel"),
  sensitivities: text("sensitivities"),
  totalMeets: integer("total_meets").default(0),
  lastMet: text("last_met")
});

export const eventPeople = sqliteTable(
  "event_people",
  {
    eventId: integer("event_id")
      .notNull()
      .references(() => events.id),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id)
  },
  (table) => [primaryKey({ columns: [table.eventId, table.personId] })]
);

export const watchers = sqliteTable(
  "watchers",
  {
    id: integer("id").primaryKey(),
    category: text("category"),
    label: text("label"),
    kind: text("kind"),
    armed: integer("armed").default(1),
    rule: text("rule"),
    threshold: text("threshold"),
    lastFired: text("last_fired"),
    snoozedUntil: text("snoozed_until"),
    createdAt: text("created_at").default(sql`(datetime('now'))`)
  },
  (table) => [
    check("watchers_kind_check", sql`${table.kind} in (${enumSqlList(WATCHER_KINDS)})`),
    check("watchers_armed_check", sql`${table.armed} in (0, 1)`)
  ]
);

export const watcherLogs = sqliteTable(
  "watcher_logs",
  {
    id: integer("id").primaryKey(),
    watcherId: integer("watcher_id").references(() => watchers.id),
    outcome: text("outcome"),
    observedAt: text("observed_at"),
    note: text("note"),
    createdAt: text("created_at").default(sql`(datetime('now'))`)
  },
  (table) => [
    check(
      "watcher_logs_outcome_check",
      sql`${table.outcome} in (${enumSqlList(WATCHER_LOG_OUTCOMES)})`
    )
  ]
);

export const params = sqliteTable("params", {
  key: text("key").primaryKey(),
  value: text("value")
});

export const resources = sqliteTable(
  "resources",
  {
    id: integer("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    sourcePersonId: integer("source_person_id").references(() => people.id),
    note: text("note"),
    createdAt: text("created_at").default(sql`(datetime('now'))`)
  },
  (table) => [
    check("resources_kind_check", sql`${table.kind} in (${enumSqlList(RESOURCE_KINDS)})`)
  ]
);

export const resourceLinks = sqliteTable(
  "resource_links",
  {
    id: integer("id").primaryKey(),
    resourceId: integer("resource_id").references(() => resources.id).notNull(),
    targetType: text("target_type").notNull(),
    targetId: integer("target_id").notNull(),
    firmness: text("firmness").default("soft").notNull(),
    reason: text("reason"),
    createdAt: text("created_at").default(sql`(datetime('now'))`)
  },
  (table) => [
    check("resource_links_target_type_check", sql`${table.targetType} in (${enumSqlList(RESOURCE_TARGET_TYPES)})`),
    check("resource_links_firmness_check", sql`${table.firmness} in (${enumSqlList(RESOURCE_FIRMNESSES)})`),
    uniqueIndex("resource_links_unique_idx").on(table.resourceId, table.targetType, table.targetId)
  ]
);

// Geocode cache (cycle-73, Geocoding Cache A). Provenance-preserving provider
// facts keyed by (provider, normalized_location); the authored event.location is
// never rewritten. Coordinates are both-present or both-null (uncertainty stays
// honest). No raw provider payload/key/error_message is ever stored here.
const GEOCODE_STATUSES = ["resolved", "ambiguous", "zero_results", "failed"] as const;
const GEOCODE_CONFIDENCES = ["high", "medium", "low", "unknown"] as const;
export const geocodeCache = sqliteTable(
  "geocode_cache",
  {
    id: integer("id").primaryKey(),
    provider: text("provider").notNull(),
    normalizedLocation: text("normalized_location").notNull(),
    locationText: text("location_text").notNull(),
    status: text("status").notNull(),
    latitude: real("latitude"),
    longitude: real("longitude"),
    displayLabel: text("display_label"),
    providerResultId: text("provider_result_id"),
    confidence: text("confidence").notNull(),
    providerStatus: text("provider_status"),
    uncertaintyJson: text("uncertainty_json"),
    createdAt: text("created_at").default(sql`(datetime('now'))`),
    updatedAt: text("updated_at"),
    lastCheckedAt: text("last_checked_at")
  },
  (table) => [
    uniqueIndex("geocode_cache_provider_location_idx").on(table.provider, table.normalizedLocation),
    check("geocode_cache_status_check", sql`${table.status} in (${enumSqlList(GEOCODE_STATUSES)})`),
    check("geocode_cache_confidence_check", sql`${table.confidence} in (${enumSqlList(GEOCODE_CONFIDENCES)})`),
    check("geocode_cache_coords_check", sql`(${table.latitude} is null) = (${table.longitude} is null)`)
  ]
);

// Travel-time cache (cycle-76, Travel Time / Transition Cost A). Provider-neutral
// travel facts for a normalized adjacent location pair, keyed by
// (provider, mode, origin_normalized, dest_normalized). Only cacheable provider
// FACTS are stored: `resolved` (carries a duration) or `no_route`. Transient
// failures (disabled/timeout/rate-limit) are NOT cached. No raw provider
// payload/key/error is ever stored. Additive — no existing table is touched.
const TRAVEL_STATUSES = ["resolved", "no_route"] as const;
export const travelTimeCache = sqliteTable(
  "travel_time_cache",
  {
    id: integer("id").primaryKey(),
    provider: text("provider").notNull(),
    mode: text("mode").notNull(),
    originNormalized: text("origin_normalized").notNull(),
    destNormalized: text("dest_normalized").notNull(),
    originLat: real("origin_lat").notNull(),
    originLng: real("origin_lng").notNull(),
    destLat: real("dest_lat").notNull(),
    destLng: real("dest_lng").notNull(),
    durationSeconds: integer("duration_seconds"),
    durationMinutes: real("duration_minutes"),
    distanceMeters: real("distance_meters"),
    status: text("status").notNull(),
    providerStatus: text("provider_status"),
    createdAt: text("created_at").default(sql`(datetime('now'))`),
    updatedAt: text("updated_at"),
    lastCheckedAt: text("last_checked_at")
  },
  (table) => [
    uniqueIndex("travel_time_cache_pair_idx").on(table.provider, table.mode, table.originNormalized, table.destNormalized),
    check("travel_time_cache_status_check", sql`${table.status} in (${enumSqlList(TRAVEL_STATUSES)})`),
    // A resolved fact carries a duration; a no_route fact does not.
    check("travel_time_cache_duration_check", sql`(${table.status} = 'no_route') or (${table.durationSeconds} is not null)`)
  ]
);

// Pinned transit facts (cycle-78, Pinned Transit Facts A). A user-authored manual
// public-transit duration for a recurring adjacent location pair, keyed by the
// DIRECTIONAL (origin_normalized, dest_normalized, mode) — A→B is distinct from
// B→A. Coordinates/labels are server-derived from the resolved geocode cache (for
// audit/display), NEVER browser-supplied. Always provenance-labeled
// (source=pinned_user); no provider/route payload stored. Additive — no existing
// table is touched.
const PINNED_TRANSIT_MODES = ["public_transit"] as const;
const PINNED_TRANSIT_SOURCES = ["pinned_user"] as const;
export const pinnedTransitFacts = sqliteTable(
  "pinned_transit_facts",
  {
    id: integer("id").primaryKey(),
    originNormalized: text("origin_normalized").notNull(),
    destNormalized: text("dest_normalized").notNull(),
    originLabel: text("origin_label"),
    destLabel: text("dest_label"),
    originLat: real("origin_lat").notNull(),
    originLng: real("origin_lng").notNull(),
    destLat: real("dest_lat").notNull(),
    destLng: real("dest_lng").notNull(),
    mode: text("mode").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    note: text("note"),
    source: text("source").notNull(),
    active: integer("active").default(1).notNull(),
    createdAt: text("created_at").default(sql`(datetime('now'))`),
    updatedAt: text("updated_at"),
    lastConfirmedAt: text("last_confirmed_at")
  },
  (table) => [
    uniqueIndex("pinned_transit_facts_pair_idx").on(table.originNormalized, table.destNormalized, table.mode),
    check("pinned_transit_facts_mode_check", sql`${table.mode} in (${enumSqlList(PINNED_TRANSIT_MODES)})`),
    check("pinned_transit_facts_source_check", sql`${table.source} in (${enumSqlList(PINNED_TRANSIT_SOURCES)})`),
    check("pinned_transit_facts_active_check", sql`${table.active} in (0, 1)`),
    check("pinned_transit_facts_duration_check", sql`${table.durationMinutes} > 0 and ${table.durationMinutes} <= 600`)
  ]
);
