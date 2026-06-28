// Deterministic location normalization (cycle-73). Produces the cache key from
// authored event location text WITHOUT mutating the original text. Order is
// stable: Unicode NFKC → trim → collapse internal whitespace → lowercase. Casing
// and spacing variants of the same location collapse to one key.
export function normalizeLocation(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}
