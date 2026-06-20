# Step 005 — review-v3 ISSUE-8 test coverage (4 new PersonDetail tests)

Cycle: 23
Pass: 6
Files Changed: web/src/PersonDetail.test.tsx (test-only, +62)

## Advisor Verdict
PASS

## Advisor Feedback
1. Reverse direction NOT missing: unavailable→preferred covered earlier in suite; preferred→unavailable is the new test. Both ISSUE-8 directions present.
2. Fetch leak: global afterEach runs vi.unstubAllGlobals + restoreAllMocks; pending promise resolved at end of test. No leak.
3. ISSUE-4 backdrop-saving and sentinel tests reuse same global afterEach — consistent cleanup.
4. Sentinel query: aria-hidden+tabindex=0 is the standard focus-trap pattern; brittle-but-acceptable; asserts activeElement, real behavior.
5. Local vi.fn still cleaned by unstubAllGlobals.

PASS

## Sonnet Response
- 적용: Advisor confirms both mutual-exclusion directions covered and that the global afterEach (vi.unstubAllGlobals + restoreAllMocks) neutralizes the two flagged regression concerns (fetch-stub leak, cleanup consistency). No code change required.
- 적용: Sentinel DOM-query strategy accepted as standard focus-trap test pattern; brittleness is acknowledged and tolerable.
- 무시: none.
