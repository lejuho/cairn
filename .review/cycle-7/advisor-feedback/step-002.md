---
step: "002"
kind: "completion"
topic: "Today.tsx manual intake bottom sheet"
files_changed:
  - web/src/Today.tsx
  - web/src/styles.css
  - web/src/Today.test.tsx
---

1. sheetEl before early returns: safe — pure JSX const, no side effects during render.
2. focus useEffect deps=[sheet.open]: safe — submitting change doesn't retrigger.
3. getTimezoneOffset in JSDOM: safe — host TZ used. Regex pattern in test (not hardcoded offset) avoids CI-TZ flakiness. ✅ already done.

No regressions. All 25 web tests pass, 81 integration tests pass.
