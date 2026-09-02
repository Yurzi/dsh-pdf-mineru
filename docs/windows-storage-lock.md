# Windows storage-lock recovery

This fork fixes the Windows `STORAGE_LOCKED` startup failure after an abnormal
DSH exit. Upstream 0.0.6 uses exclusive creation of `.process.lock` on non-Linux
systems, so even a dead process's file blocks subsequent starts indefinitely.

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
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm exec vitest run tests/process-lock-windows.spec.ts tests/storage.spec.ts -t ProcessLock
```

The Windows regression suite runs the actual lock implementation in independent
child processes, kills a test owner without cleanup, and launches simultaneous
contenders against the same stale lock. Tests use only temporary fixture data.

The existing full suite includes POSIX-style path-string assertions and symlink
fixtures requiring additional privileges on Windows. Linux CI runs the full
suite; Windows CI runs the lock regression and composition-lifecycle suites.

The fork also includes the RC2 credential compatibility adapter and the
collapsible settings card. See [credential compatibility](credential-compatibility.md)
for the supported client API paths and validation.
