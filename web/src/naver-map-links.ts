// Naver Map external link helpers (cycle-77). PURE, deterministic string
// building only — no Naver API call, no fetch, no scraping, no storage. Cairn
// constructs best-effort public web URLs from coordinates it already has; it does
// NOT own Naver place ids and does NOT treat Naver's web route format as a stable
// provider contract.

const BASE62_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function base62(n: number): string {
  if (n === 0) return "0";
  let x = n;
  let out = "";
  while (x > 0) {
    out = BASE62_ALPHABET[x % 62] + out;
    x = Math.floor(x / 62);
  }
  return out;
}

// Encode one WGS84 coordinate into Naver's observed direction coordinate token:
//   token = base62(round((coord + 200) * 10_000_000))
// Verified against the cycle-77 plan samples (e.g. 127.0248712 -> "3zjD4Y").
// Returns null for non-finite or out-of-range input so render paths never throw.
export function naverCoordToken(coord: number): string | null {
  if (!Number.isFinite(coord) || coord < -180 || coord > 180) return null;
  return base62(Math.round((coord + 200) * 10_000_000));
}

// Single-location Naver Map search URL. The query is fully percent-encoded, so
// Korean text, commas, and slashes can never corrupt the path.
export function naverSearchUrl(query: string): string {
  return `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
}

export type NaverDirectionsPoint = { lat: number; lng: number; label?: string | null };

// One `/p/directions` endpoint segment: `lonToken,latToken,label,placeId,placeType`.
// Cairn has no Naver place id/type yet, so those two fields are intentionally
// EMPTY placeholders — isolated here so a later Naver place-search cycle can swap
// in real ids/types without touching callers. Returns null if either coordinate
// token is invalid.
// WGS84 axis bounds (cycle-77 review-v1 ISSUE-1): latitude is [-90,90],
// longitude is [-180,180]. `naverCoordToken` alone only guards the broad
// [-180,180] formula range, so an impossible latitude (e.g. 120) would still
// tokenize — validate each axis explicitly before building a segment.
function isValidLat(n: number): boolean {
  return Number.isFinite(n) && n >= -90 && n <= 90;
}
function isValidLng(n: number): boolean {
  return Number.isFinite(n) && n >= -180 && n <= 180;
}

function directionsSegment(point: NaverDirectionsPoint): string | null {
  if (!isValidLat(point.lat) || !isValidLng(point.lng)) return null;
  const lonToken = naverCoordToken(point.lng);
  const latToken = naverCoordToken(point.lat);
  if (lonToken == null || latToken == null) return null;
  return `${lonToken},${latToken},${encodeURIComponent(point.label ?? "")},,`;
}

// Best-effort Naver public-transit directions URL between two coordinate+label
// endpoints. The route shape (`/p/directions/{origin}/{destination}/-/transit`,
// lon-first tokens, the `?c=15.00,0,0,0,dh` camera param, and the empty place
// id/type fields) is REVERSE-ENGINEERED from Naver's web app — it is a best-effort
// external link, NOT an official/stable Naver API contract. Returns null (so the
// caller renders nothing) when either endpoint lacks usable coordinates.
export function naverTransitDirectionsUrl(origin: NaverDirectionsPoint, dest: NaverDirectionsPoint): string | null {
  const originSeg = directionsSegment(origin);
  const destSeg = directionsSegment(dest);
  if (originSeg == null || destSeg == null) return null;
  return `https://map.naver.com/p/directions/${originSeg}/${destSeg}/-/transit?c=15.00,0,0,0,dh`;
}
