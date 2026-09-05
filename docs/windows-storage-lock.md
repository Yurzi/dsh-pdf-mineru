# Storage lock and crash recovery

This architecture ensures fail-closed single-process `storageRoot` isolation across all supported platforms (Linux, Windows, macOS). Exclusive creation of `.process.lock` prevents multiple concurrent DSH processes from mutating the same storageRoot.

## Design & Recovery Rules

The lock uses atomic file creation (`writeFile` with `flag: 'wx'`) at `storageRoot/.process.lock`, containing JSON metadata:

```json
{
  "pid": 12345,
  "ownerToken": "owner_abcdef...",
  "createdAt": 1700000000000,
  "hostname": "my-host"
}
```

### Contention and Recovery

When an acquisition attempt encounters `EEXIST`:

1. It reads and parses the existing lock payload.
2. If the lock was already acquired by this process and matches this instance's `ownerToken`, acquisition succeeds idempotently.
3. If the lock was created by another host, acquisition fails immediately with `STORAGE_LOCKED`.
4. It probes whether the recorded owner PID is still running using `process.kill(existing.pid, 0)`:
   - If `ESRCH` is returned, the owner process has exited. The stale lock file is safely unlinked, and acquisition is re-attempted.
   - If the PID is still alive, or if probing encounters `EPERM` or any ambiguous state, it fails closed with `STORAGE_LOCKED`.

### Safe Release

Normal release verifies that the lock file exists, is currently held, and that the recorded `ownerToken` and `pid` match this instance before unlinking. This prevents accidentally removing a successor process's valid lock.

## Validation

```sh
pnpm install
pnpm run typecheck
pnpm exec vitest run tests/storage.spec.ts -t ProcessLock
```
