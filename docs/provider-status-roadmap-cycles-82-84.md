# Provider Status Roadmap Cycles 82-84

Created: 2026-06-29

## Context

Google Maps and Naver place search now depend on local server env/provider
configuration. When either key, API restriction, billing, or upstream state is
wrong, the app currently fails only at the moment a user opens map/place flows
or runs `curl`.

The product needs a quiet in-app signal. This roadmap keeps it diagnostic,
non-mutating, and low quota.

## Cycle 82 — Provider Status Badges A

Status: active plan in `.review/cycle-82/`.

Add server-owned provider status aggregation with TTL and compact AppNav badges.

Scope:
- `GET /api/providers/status`
- Google row from existing map gateway smoke.
- Naver row from existing place-search gateway fixed query.
- 5-minute TTL cache.
- AppNav passive badges.
- No logos/assets yet.
- No DB, cron, secrets, provider raw payloads, or browser-side provider keys.

Done when:
- User can see Google/Naver connected/disabled/degraded state in the web app.
- Repeated browser polling does not repeatedly hit upstream providers inside TTL.

## Cycle 83 — Provider Diagnostics Detail B

Candidate.

Add a small diagnostic sheet opened from the badges.

Scope:
- Last checked time.
- User-safe reason copy for denied/rate-limited/unavailable.
- Manual "다시 확인" action that bypasses or refreshes TTL with rate guard.
- Setup hints: Google API restriction/IP/billing, Naver search API credentials.
- No secret display.

## Cycle 84 — Provider Setup Guardrails C

Candidate.

Add deploy/runtime guardrails around provider setup.

Scope:
- Production env example includes Google/Naver provider vars.
- `redeploy-production.sh` optional preflight checks provider status after restart.
- Docs for Google API restrictions and Naver Developers Search API.
- No automatic env mutation or secret generation.
