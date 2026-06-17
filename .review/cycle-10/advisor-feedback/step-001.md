---
step: "001"
kind: "approach"
topic: "Thread index + /threads/new + Today intake thread picker"
---

1. /threads index: exact path === "/threads" before startsWith("/threads/") in App.tsx. ThreadIndex.tsx with 4 states. "+ 스레드" link lives in Today header (no app-level nav shell).
2. /threads/new: ThreadNew.tsx, client trim-validate, disable-while-posting, window.location.href on success.
3. Today picker: fetch threads lazily on sheet open, cache in state. threadId omitted from body when unselected. Send as number not string (parseInt on select value).

Risk noted: threadId must be number not string from <select>. Will parseInt.

All APPLY. No items ignored.
