import type { PinnedTransitFact, UpsertPinnedTransitRequest } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { findEventById } from "../repositories/events.js";
import { normalizeLocation } from "../maps/normalize.js";
import { findGeocodeByNormalizedSet, type GeocodeCacheRow } from "../repositories/geocode-cache.js";
import { upsertPinned, type PinnedTransitRow } from "../repositories/pinned-transit-facts.js";

// Pinned transit fact orchestration (cycle-78). Resolves two event ids to their
// authored locations and EXISTING resolved geocode cache rows (NO geocoding
// provider call), derives the directional pair identity + coordinates SERVER-SIDE
// (never from the browser), and upserts one user-authored fact. Typed domain
// errors on any unmet precondition leave the DB untouched.

export const PINNED_TRANSIT_MODE = "public_transit";
const SOURCE = "pinned_user";

export type PinnedTransitServiceResult =
  | { ok: true; data: PinnedTransitFact }
  | { ok: false; kind: "not_found" | "location_missing" | "location_unresolved" };

export function upsertPinnedTransitFact(db: CairnDatabase, req: UpsertPinnedTransitRequest): PinnedTransitServiceResult {
  const fromEvent = findEventById(db, req.fromEventId);
  const toEvent = findEventById(db, req.toEventId);
  if (!fromEvent || !toEvent) return { ok: false, kind: "not_found" };

  const fromLoc = (fromEvent.location ?? "").trim();
  const toLoc = (toEvent.location ?? "").trim();
  if (fromLoc.length === 0 || toLoc.length === 0) return { ok: false, kind: "location_missing" };

  const originNorm = normalizeLocation(fromLoc);
  const destNorm = normalizeLocation(toLoc);

  // Coordinates come ONLY from the existing geocode cache — no provider/geocode call.
  const rows = findGeocodeByNormalizedSet(db, [originNorm, destNorm]);
  const origin = resolvedCoord(rows, originNorm, fromLoc);
  const dest = resolvedCoord(rows, destNorm, toLoc);
  if (!origin || !dest) return { ok: false, kind: "location_unresolved" };

  const row = upsertPinned(db, {
    originNormalized: originNorm,
    destNormalized: destNorm,
    originLabel: origin.label,
    destLabel: dest.label,
    originLat: origin.lat,
    originLng: origin.lng,
    destLat: dest.lat,
    destLng: dest.lng,
    mode: PINNED_TRANSIT_MODE,
    durationMinutes: req.durationMinutes,
    note: req.note ?? null,
    source: SOURCE
  });
  return { ok: true, data: toData(row) };
}

function resolvedCoord(rows: GeocodeCacheRow[], norm: string, authored: string): { lat: number; lng: number; label: string } | null {
  const r = rows.find((x) => x.normalizedLocation === norm && x.status === "resolved" && x.latitude != null && x.longitude != null);
  if (!r) return null;
  return { lat: r.latitude!, lng: r.longitude!, label: r.displayLabel ?? authored };
}

function toData(row: PinnedTransitRow): PinnedTransitFact {
  return {
    id: row.id,
    originNormalized: row.originNormalized,
    destNormalized: row.destNormalized,
    originLabel: row.originLabel,
    destLabel: row.destLabel,
    originLat: row.originLat,
    originLng: row.originLng,
    destLat: row.destLat,
    destLng: row.destLng,
    mode: row.mode as PinnedTransitFact["mode"],
    durationMinutes: row.durationMinutes,
    note: row.note,
    source: row.source as PinnedTransitFact["source"],
    active: row.active === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastConfirmedAt: row.lastConfirmedAt
  };
}
