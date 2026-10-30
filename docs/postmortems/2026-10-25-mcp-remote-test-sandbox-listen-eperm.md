# MCP remote test sandbox `listen EPERM`

## Symptom and impact

Two consecutive `npm test` runs in `mcp/` timed out in the `remote.test.ts`
`beforeAll` hook. Node reported the stable signature
`listen EPERM: operation not permitted 127.0.0.1`. The four remote HTTP tests
were skipped by the failed hook. The other 26 MCP tests passed in both runs.

## Timeline and evidence

- A preceding `corepack pnpm --filter @cairn/mcp test` run passed all 30 tests,
  including `remote.test.ts`.
- A later `npm test` run, executed alongside lint and build, received `EPERM`
  while binding an ephemeral localhost port.
- A standalone `npm test` retry reproduced the same `EPERM` signature.
- `npm run lint` and `npm run build` both passed.

## Root cause

Confirmed: the failure occurs at the operating-system socket bind boundary,
before the remote handler or an assertion runs. The managed execution sandbox
denied the localhost listener. No application-level failure was observed.

The reason the earlier test invocation was allowed to bind while the later
invocations were denied is unknown and is treated as an environment-policy
variation, not a code hypothesis.

## Resolution and verification

No code workaround was applied because replacing the real localhost HTTP
integration boundary with a mock would weaken the existing test. Verification
used the successful earlier full MCP test run plus focused non-listening unit
tests for event protocol behavior, signing, persistence, validation, parsing,
and delivery.

No Reason Network CLI command was run during verification.

## Prevention and follow-up

- Treat `listen EPERM: operation not permitted 127.0.0.1` in managed sandboxes
  as an environment capability failure when it occurs before test setup.
- Do not repeatedly retry the same bind command.
- Keep `remote.test.ts` as a real HTTP boundary test and run it in an
  environment that permits ephemeral localhost listeners.
