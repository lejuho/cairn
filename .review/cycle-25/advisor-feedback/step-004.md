# Step 004 — commit-2 frontend: apiJson migration + relation section + bottom sheet + delete

Cycle: 25
Pass: 2
Files Changed: web/src/Thread.tsx, web/src/ThreadIndex.tsx, web/src/ThreadNew.tsx, web/src/Thread.test.tsx, web/src/ThreadIndex.test.tsx

## Advisor Verdict
NEEDS_REVIEW

## Advisor Feedback
1. Cleanup at line 107 (`return () => { stale = true; }`) is dead code: openLinkSheet is `onClick`, not an effect; React never invokes the return value. `stale` is only ever false, so the network/close-reopen guard it implies does no work.
2. Real stale-write risk is covered separately, not by `stale`: every setLinkSheet uses `prev.tag === "open" ? ... : prev`, so a resolve after close is a no-op. Close-then-fast-reopen writes into the new open sheet — acceptable since payload is identical fetch data.
3. Lines 87-97: confirmed byte-identical if/else branches (only the dead `linkSheet.tag !== "open"` distinguishes them). Pure redundancy; collapses to one block.
4. access_session_required works on both paths: api.ts throws AccessSessionError on fetch rejection (line 33-37) and on 302/401/403/CF-HTML (41-60); consumers catch `err.kind === "access_session_required"` (line 70). Correct.

Steps: dead/misleading code (line 107) + duplicated branches (87-97) should be removed; not behavior bugs but warrant cleanup.

Verdict: NEEDS_REVIEW

## Sonnet Response
- 적용: openLinkSheet()의 dead cleanup `return () => { stale = true; }` 및 한 번도 true가 되지 않는 `stale` 플래그 제거 — click handler라 React가 반환값을 호출하지 않음. stale-write 안전성은 이미 모든 setLinkSheet의 `prev.tag === "open" ? ... : prev` 가드가 담당하므로 동작 변화 없음.
- 적용: 87-97줄의 byte-identical if/else 두 분기를 단일 블록으로 collapse (`linkSheet.tag !== "open"` 죽은 조건 제거).
- 확인(무시 아님): access_session_required는 apiJson의 status-code 경로(302/401/403/CF-HTML)와 fetch-rejection 경로 양쪽 모두에서 동일한 AccessSessionError(kind)를 throw하고, 소비자가 `err.kind === "access_session_required"`로 잡으므로 양 경로 정상 동작 — regression 없음. 회귀 우려 #2 해소.
