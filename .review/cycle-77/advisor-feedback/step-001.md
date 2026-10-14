# Step 001 — Approach check: Naver External Directions Link A (helper + Today integration)

Cycle: 77
Pass: 1
Files Changed: (approach) — planned: web/src/naver-map-links.ts(+test), web/src/Today.tsx(+test), web/src/styles.css, docs/*

## Advisor Verdict
PASS

## Advisor Feedback
1. Token formula verified against 4 samples: sound. Lock it in a test so a future refactor can't drift.
2. encodeURIComponent on label is correct — it escapes `,` `/` space, so labels can't break segment/path delimiters. Good.
3. Risk: the directions URL shape (lon-first order, trailing `,,` placeholders, `?c=15.00,0,0,0,dh`) is reverse-engineered, not a contract. Keep it isolated in the helper + comment it unverified/best-effort. Do not assert parity you can't prove.
4. Q3: keep `${lat},${lng}` fallback only; prefer label search when present — label is more robust.
5. Fail-soft (null not throw) in render: correct. Confirm both contexts resolved AND url non-null before render.
PASS

## Sonnet Response
- 적용 전부: (1) base62 token 공식을 plan 4개 샘플(`3zjD4Y`/`2AJrSI`/`3zk0AC`/`2AJz2N`)로 테스트에 고정. (2) label은 encodeURIComponent로 인코딩(comma/slash/Korean 안전). (3) directions URL 형태(lon-first, trailing `,,` placeholder, `?c=15.00,0,0,0,dh`)는 helper 내부에 격리 + "reverse-engineered/best-effort, not an official Naver contract" 주석 명시; 테스트는 token 정확성 + URL 템플릿 shape만 검증(증명 못 하는 parity 단정 금지). (4) resolved search query = displayLabel ?? locationText ?? `${lat},${lng}`(label 우선, 좌표 fallback). (5) 모든 helper는 render path에서 throw 대신 null 반환; transition 길찾기 링크는 양 endpoint가 resolved+non-null 좌표 AND url!=null일 때만 렌더(fail soft).
- 무시: 없음.
