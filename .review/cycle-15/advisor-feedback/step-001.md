---
name: cycle-15-step-001-approach
description: Approach check for cycle-15 People Tagging A — transaction API, channel enum, loadData expansion
metadata:
  type: feedback
---

Approach check: cycle-15 People Tagging A

**Verdict: PASS**

1. Transaction: Use Drizzle `db.transaction((tx) => { tx.delete...; tx.insert... })`. CairnDatabase = BetterSQLite3Database, synchronous — no async/await needed. Matches existing sync repo pattern.

2. Channel enum: `channel` is plain `text("channel")`, no DB CHECK. Define `z.enum([...])` in `shared/src/people.ts` as source of truth. No schema CHECK constraint added (out of scope).

3. loadData expansion: extend to `Promise.allSettled([today, threads, people])` → named destructuring `[todayRes, threadsResult, peopleResult]`. People optional (fulfilled-only), mirroring threads pattern.
