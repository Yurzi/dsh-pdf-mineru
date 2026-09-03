# Windows storage-lock recovery

This fix resolves the Windows `STORAGE_LOCKED` startup failure after an abnormal
DSH exit. Exclusive creation of `.process.lock` on non-Linux systems causes even a dead
process's file to block subsequent starts indefinitely.

## Recovery rules

On Windows, the plugin acquires a named pipe derived from the canonical,
case-normalized storage path before touching ownership metadata. Windows
releases this endpoint when its process exits. The file protocol is also
retained so that an active, older plugin cannot be bypassed.

An existing file is reclaimed only when all of these checks succeed:

- It is a regular file, not a symbolic link or directory.
- Its metadata is valid and belongs to this host.
- Probing its PID returns `ESRCH` (the process is absent).
- Its file identity and contents have not changed during the check.

Live PIDs (including possible PID reuse), `EPERM`, foreign hosts, corrupt files,
and other ambiguous states remain locked. Never delete a lock merely because
it is old. Stop and inspect its owner if automatic recovery refuses it.

The new owner publishes a fully written temporary record with an exclusive
hard link. This avoids partial lock metadata on abrupt termination and preserves
compatibility with legacy `wx` file acquisition. A crash before publication may
leave a uniquely named `.process.lock.owner_*.tmp` file, but it never blocks
startup. Windows storage must be local and support hard links (e.g. NTFS).
This is not a distributed lock for shared storage across machines.

Normal release removes only this instance's metadata while still holding the
pipe, then releases the pipe. Recovery does not touch `results`, `staging`,
configuration, credentials, or other processes.

Linux retains its abstract-socket authority. Other non-Windows platforms retain
their existing conservative file-lock behavior.

## Validation

```sh
pnpm install
pnpm run typecheck
pnpm exec vitest run tests/process-lock-windows.spec.ts tests/storage.spec.ts -t ProcessLock
```
