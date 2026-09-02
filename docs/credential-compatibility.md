# Credential client compatibility

The settings page uses a single normalized credential interface. The browser
entry selects the carrier without sending probe requests:

- On DSH 0.1.1-rc.2, `connection.api.credentials` accepts object payloads and
  wraps replies in `response.result`. The adapter maps describe/set/unset to
  this shape and unwraps `value.credentials` for descriptions.
- When the legacy face is absent, a Cordis child fiber waits for `remote` and
  `remote.credentials`, then registers settings using the native newer API.
  Removing/replacing the service removes/recreates that registration; the
  entry does not capture an unavailable Remote or require it on RC2.

The adapter does not resolve or persist secret values, issue test writes,
retry failures, or fall back to another API after an operation has failed.
Existing credential helpers still trim submitted keys, reject blank writes,
and preserve configured/writable/source status and error messages.
No provider configuration schema or dependency graph changes are needed.

Run the mock/fixture-only regression suite:

```sh
pnpm run typecheck
pnpm exec vitest run tests/client-credentials.spec.ts tests/client-settings-card.spec.ts
pnpm exec tsdown --config tsdown.config.ts --filter dsh-pdf-mineru/client
```

Both client paths are contract-tested. The RC2-only local installation was
separately tested against DSH 0.1.1-rc.2; newer service timing is tested with
real Cordis service lifecycles, not a live DSH alpha installation.
