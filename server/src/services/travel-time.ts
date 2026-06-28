import type { EventRow, FeasibilityParams, TransitionTravel } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import type { MapGateway, TravelPoint } from "../maps/gateway.js";
import { normalizeLocation } from "../maps/normalize.js";
import { findGeocodeByNormalizedSet } from "../repositories/geocode-cache.js";
import { findTravelByKey, upsertTravel, type TravelCacheRow } from "../repositories/travel-time-cache.js";
import { listActivePinned, type PinnedTransitRow } from "../repositories/pinned-transit-facts.js";

// Mode used to match a user-pinned public-transit fact (cycle-78).
export const PINNED_TRANSIT_MODE = "public_transit";
// Key for the pinned-fact lookup map: directional normalized origin|dest.
export function pinnedPairKey(originNorm: string, destNorm: string): string {
  return `${originNorm}|${destNorm}`;
}

// Read-only directional lookup of active pinned public-transit facts for the
// route layer (cycle-78). Fail-open: any read error yields an empty map so a
// pinned-facts problem can never break Today/feasibility day math.
export function buildPinnedPairMap(db: CairnDatabase): Map<string, PinnedTransitRow> {
  const map = new Map<string, PinnedTransitRow>();
  try {
    for (const p of listActivePinned(db)) {
      if (p.mode === PINNED_TRANSIT_MODE) map.set(pinnedPairKey(p.originNormalized, p.destNormalized), p);
    }
  } catch {
    // empty map → existing cycle-76 travel behavior, never an error
  }
  return map;
}

// Travel-time evidence builder (cycle-76). IMPURE (geocode/travel cache reads,
// gateway calls, idempotent travel-cache writes) — it lives at the route layer so
// the feasibility computation stays pure. It resolves adjacent scheduled event
// pairs to geocode coordinates, reads the travel cache, and calls the provider
// ONLY when both endpoints have usable coordinates and policy allows. Every
// failure path (missing geocode, same location, disabled/failed provider) fails
// OPEN to non-fresh evidence so Today/feasibility never error.

export const DEFAULT_TRAVEL_MODE = "drive";
// A cached resolved duration is `fresh` within this window, otherwise `stale`.
const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000;
// ~50m at Seoul's latitude — endpoints this close are treated as the same place.
const SAME_LOCATION_EPSILON_DEG = 0.0005;

export type TravelFactsOptions = { allowProvider: boolean; mode?: string };

export async function buildDayTravelFacts(
  db: CairnDatabase,
  gateway: MapGateway | undefined,
  scheduled: EventRow[],
  params: FeasibilityParams,
  now: string,
  opts: TravelFactsOptions,
  // User-pinned public-transit facts keyed by `pinnedPairKey(originNorm,destNorm)`
  // (cycle-78). A match short-circuits BEFORE any cache/provider call. Defaults
  // to empty so existing callers/tests are byte-identical.
  pinnedByPair: Map<string, PinnedTransitRow> = new Map()
): Promise<Map<string, TransitionTravel>> {
  void params; // travelMargin is applied in the pure feasibility step, not here.
  const facts = new Map<string, TransitionTravel>();
  if (scheduled.length < 2) return facts;

  const mode = opts.mode ?? DEFAULT_TRAVEL_MODE;
  const provider = gateway?.provider ?? "disabled";
  const allowProvider = opts.allowProvider && gateway != null && provider !== "disabled";

  // Resolve each event's coordinates from the cycle-73 geocode cache.
  const normByEvent = new Map<number, string | null>();
  const keys = new Set<string>();
  for (const e of scheduled) {
    const loc = e.location;
    if (loc && loc.trim().length > 0) {
      const n = normalizeLocation(loc);
      normByEvent.set(e.id, n);
      keys.add(n);
    } else {
      normByEvent.set(e.id, null);
    }
  }
  const coordsByNorm = new Map<string, TravelPoint>();
  for (const r of findGeocodeByNormalizedSet(db, [...keys])) {
    if (r.status === "resolved" && r.latitude != null && r.longitude != null && !coordsByNorm.has(r.normalizedLocation)) {
      coordsByNorm.set(r.normalizedLocation, { lat: r.latitude, lng: r.longitude });
    }
  }

  // One resolved evidence per deduped (provider, mode, origin, dest) pair, so a
  // location pair that repeats across the day triggers at most one provider call.
  const pairCache = new Map<string, TransitionTravel>();

  for (let i = 0; i < scheduled.length - 1; i += 1) {
    const from = scheduled[i]!;
    const to = scheduled[i + 1]!;
    const fromNorm = normByEvent.get(from.id) ?? null;
    const toNorm = normByEvent.get(to.id) ?? null;
    const fromCoord = fromNorm ? coordsByNorm.get(fromNorm) : undefined;
    const toCoord = toNorm ? coordsByNorm.get(toNorm) : undefined;

    let evidence: TransitionTravel;
    if (!fromCoord || !toCoord || !fromNorm || !toNorm) {
      evidence = quiet("missing_geocode", mode, "travel_missing_geocode");
    } else if (fromNorm === toNorm || isSameLocation(fromCoord, toCoord)) {
      evidence = quiet("same_location", mode, "travel_same_location");
    } else {
      // A user-pinned fact wins over any provider/cache travel for this pair and
      // short-circuits BEFORE resolvePair, so no provider/cache call is made.
      const pinned = pinnedByPair.get(pinnedPairKey(fromNorm, toNorm));
      if (pinned) {
        evidence = pinnedEvidence(pinned);
      } else {
        const pairKey = `${provider}|${mode}|${fromNorm}|${toNorm}`;
        let pe = pairCache.get(pairKey);
        if (!pe) {
          pe = await resolvePair(db, gateway, provider, mode, fromNorm, toNorm, fromCoord, toCoord, now, allowProvider);
          pairCache.set(pairKey, pe);
        }
        evidence = pe;
      }
    }
    facts.set(`${from.id}:${to.id}`, evidence);
  }
  return facts;
}

async function resolvePair(
  db: CairnDatabase,
  gateway: MapGateway | undefined,
  provider: string,
  mode: string,
  originNorm: string,
  destNorm: string,
  origin: TravelPoint,
  dest: TravelPoint,
  now: string,
  allowProvider: boolean
): Promise<TransitionTravel> {
  const nowMs = Date.parse(now);
  const cached = findTravelByKey(db, provider, mode, originNorm, destNorm);

  if (cached) {
    const ageMs = cached.lastCheckedAt ? nowMs - Date.parse(cached.lastCheckedAt) : Number.POSITIVE_INFINITY;
    // A `no_route` fact has no usable duration — it is unavailable evidence,
    // never `fresh`/`stale` (it must never feed a gap requirement).
    if (cached.status === "no_route") {
      return unavailable(mode, "travel_no_route", { provider, providerStatus: cached.providerStatus, ageMinutes: msToMin(ageMs) });
    }
    if (Number.isFinite(ageMs) && ageMs <= FRESH_WINDOW_MS) {
      return fromCachedDuration("fresh", cached, mode, ageMs);
    }
    // Stale: try a bounded refresh; otherwise keep the stale duration as context.
    if (allowProvider) {
      const refreshed = await callAndStore(db, gateway!, provider, mode, originNorm, destNorm, origin, dest);
      if (refreshed) return refreshed;
    }
    return fromCachedDuration("stale", cached, mode, ageMs);
  }

  // Cache miss: call the provider once when allowed, else unavailable.
  if (allowProvider) {
    const fetched = await callAndStore(db, gateway!, provider, mode, originNorm, destNorm, origin, dest);
    if (fetched) return fetched;
  }
  return unavailable(mode, "travel_unavailable", { provider: provider === "disabled" ? null : provider });
}

// Calls the gateway once; on a cacheable provider FACT writes one row. Transient/
// scoped errors return null (NOT cached) so the caller fails open to unavailable.
async function callAndStore(
  db: CairnDatabase,
  gateway: MapGateway,
  provider: string,
  mode: string,
  originNorm: string,
  destNorm: string,
  origin: TravelPoint,
  dest: TravelPoint
): Promise<TransitionTravel | null> {
  const result = await gateway.travelTime(origin, dest, mode);
  if (!result.ok) return null;
  const base = {
    provider, mode, originNormalized: originNorm, destNormalized: destNorm,
    originLat: origin.lat, originLng: origin.lng, destLat: dest.lat, destLng: dest.lng
  };
  if (result.outcome.status === "resolved") {
    const durationMinutes = result.outcome.durationSeconds / 60;
    const row = upsertTravel(db, {
      ...base,
      durationSeconds: result.outcome.durationSeconds,
      durationMinutes,
      distanceMeters: result.outcome.distanceMeters,
      status: "resolved",
      providerStatus: result.outcome.providerStatus
    });
    return fromCachedDuration("fresh", row, mode, 0);
  }
  // no_route — a stable cacheable fact, surfaced as unavailable evidence.
  upsertTravel(db, { ...base, durationSeconds: null, durationMinutes: null, distanceMeters: null, status: "no_route", providerStatus: result.outcome.providerStatus });
  return unavailable(mode, "travel_no_route", { provider, providerStatus: result.outcome.providerStatus });
}

function fromCachedDuration(status: "fresh" | "stale", row: TravelCacheRow, mode: string, ageMs: number): TransitionTravel {
  const durationMinutes = row.durationMinutes ?? (row.durationSeconds != null ? row.durationSeconds / 60 : null);
  return {
    status,
    durationMinutes,
    distanceMeters: row.distanceMeters,
    provider: row.provider,
    providerStatus: row.providerStatus,
    mode,
    ageMinutes: Number.isFinite(ageMs) ? msToMin(ageMs) : null,
    reasonCodes: [status === "fresh" ? "travel_fresh" : "travel_stale"]
  };
}

// A user-pinned manual fact is usable travel (status fresh) but provenance-
// labeled `pinned_user` with provider:null — it feeds the same gap math as a
// fresh provider fact while the UI/gap reasons keep it distinct.
function pinnedEvidence(p: PinnedTransitRow): TransitionTravel {
  // Carry the user-authored manual detail note (cycle-80); blank/whitespace → null.
  // Only pinned evidence carries a note — provider/cache evidence never sets it.
  const note = p.note != null && p.note.trim().length > 0 ? p.note.trim() : null;
  return {
    status: "fresh",
    durationMinutes: p.durationMinutes,
    distanceMeters: null,
    provider: null,
    providerStatus: null,
    mode: p.mode,
    ageMinutes: null,
    reasonCodes: ["travel_pinned_transit"],
    source: "pinned_user",
    note
  };
}

function quiet(status: "missing_geocode" | "same_location", mode: string, reason: string): TransitionTravel {
  return { status, durationMinutes: null, distanceMeters: null, provider: null, providerStatus: null, mode, ageMinutes: null, reasonCodes: [reason] };
}

function unavailable(mode: string, reason: string, extra: { provider?: string | null; providerStatus?: string | null; ageMinutes?: number | null }): TransitionTravel {
  return {
    status: "unavailable",
    durationMinutes: null,
    distanceMeters: null,
    provider: extra.provider ?? null,
    providerStatus: extra.providerStatus ?? null,
    mode,
    ageMinutes: extra.ageMinutes ?? null,
    reasonCodes: [reason]
  };
}

function isSameLocation(a: TravelPoint, b: TravelPoint): boolean {
  return Math.abs(a.lat - b.lat) < SAME_LOCATION_EPSILON_DEG && Math.abs(a.lng - b.lng) < SAME_LOCATION_EPSILON_DEG;
}

function msToMin(ms: number): number {
  return Math.round(ms / 60000);
}
