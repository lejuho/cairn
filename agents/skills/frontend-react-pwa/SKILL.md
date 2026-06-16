---
name: frontend-react-pwa
description: Cairn React, Vite, and vite-plugin-pwa frontend work. Use for web pages, components, API integration, offline and installable behavior, semantic design tokens, four-state data screens, bottom sheets, mobile interactions, and accessibility.
---

# Cairn React PWA Frontend

## Preserve application boundaries

- Build `web` with React, Vite, and `vite-plugin-pwa`; do not introduce Next.js
  conventions or server code into the client.
- Import API payload types and runtime schemas from `shared`.
- Keep presentational components data-in and callbacks-out. Put network access
  in a page-level or dedicated data layer, not in reusable cards or sheets.
- Do not use `any`, unchecked API payloads, or component-local mock contracts.

## Use the design system

- Read `docs/cairn-design-system.md` before implementing a screen.
- Reference semantic CSS tokens only. Do not hardcode component colors.
- Apply A temperature to execution and decision surfaces and B temperature to
  reflection surfaces. Restrict the serif face to B-context headings.
- Keep touch targets at least 44px and primary actions in the mobile thumb
  zone. Start with a single-column mobile layout and enhance wider screens.
- Honor `prefers-reduced-motion`; motion may clarify state but must not be
  required to understand or operate the UI.

## Implement all four states

- Every data screen provides `loading`, `quiet`, `live`, and `error` states.
- Use shape-matched skeletons for loading, a rewarding quiet state, prioritized
  content for live, and a specific recovery action for error.
- Preserve last known data when a refresh fails where the product contract
  allows it.
- Treat LLM unavailable as a scoped generation or parsing state, not a global
  application failure. Deterministic views remain usable.

## Prefer low-input interactions

- Prefer no action, then tap, and use typing only for push replies and natural
  language thread creation.
- Use bottom sheets for decision details, person details, and annotations.
- Expose actions as callback props; do not hide mutations or navigation inside
  reusable visual components.
- Suggestions show a reason and never apply themselves without confirmation.

## Respect PWA and offline limits

- Cache the application shell and explicitly selected recent read data.
- Do not invent offline write conflict behavior. Queue or optimistic writes
  only when a cycle defines reconciliation and failure semantics.
- Make install, update, and offline states visible without blocking ordinary
  online use.

## Verify the screen

- Automate the four states and critical interactions with Vitest.
- Check mobile and wide layouts, light and dark themes, reduced motion, 44px
  targets, keyboard focus, and bottom-sheet dismissal.
- Confirm semantic tokens are used and that quiet/error copy matches the
  product tone.
