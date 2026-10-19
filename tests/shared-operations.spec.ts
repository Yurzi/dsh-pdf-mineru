import { describe, expect, it, onTestFinished } from 'vitest'
import { asCacheKey, asProviderConfigId } from '../src/domain/ids.js'
import { SharedOperationRegistry, type SharedOutcome } from '../src/service/shared-operations.js'

function registry(): SharedOperationRegistry {
  const operations = new SharedOperationRegistry()
  onTestFinished(() => operations.shutdown())
  return operations
}

describe('SharedOperationRegistry', () => {
  it('coalesces by cache key and credential authority, never across authorities', async () => {
    const operations = registry()
    const cacheKey = asCacheKey('a'.repeat(64))
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const runner = async (): Promise<SharedOutcome> => { await gate; return { state: 'failed' } }
    const first = operations.reserve(cacheKey, asProviderConfigId('mp_account_a'), 5000)
    operations.start(first.operation, runner)
    const second = operations.reserve(cacheKey, asProviderConfigId('mp_account_b'), 5000)
    operations.start(second.operation, runner)
    const duplicate = operations.reserve(cacheKey, asProviderConfigId('mp_account_a'), 5000)

    expect([first.created, second.created, duplicate.created]).toEqual([true, true, false])
    expect(duplicate.operation).toBe(first.operation)
    expect(second.operation).not.toBe(first.operation)

    release()
    const signal = new AbortController().signal
    await Promise.all([first.operation.waitForOutcome(signal), second.operation.waitForOutcome(signal)])
    expect(operations.activeOperationCount()).toBe(0)
  })

  it('releases an unstarted reservation so the same key can be retried', async () => {
    const operations = registry()
    const cacheKey = asCacheKey('b'.repeat(64))
    const authority = asProviderConfigId('mp_release_test')
    const first = operations.reserve(cacheKey, authority, 5000)
    const waiting = first.operation.waitForOutcome(new AbortController().signal)

    expect(operations.release(first.operation, new Error('setup failed'))).toBe(true)
    await expect(waiting).rejects.toThrow('setup failed')
    expect(operations.activeOperationCount()).toBe(0)
    expect(operations.reserve(cacheKey, authority, 5000).created).toBe(true)
  })

  it('cannot release a started producer; waiter cancellation leaves it running', async () => {
    const operations = registry()
    const reservation = operations.reserve(asCacheKey('c'.repeat(64)), asProviderConfigId('mp_started'), 5000)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    operations.start(reservation.operation, async () => { await gate; return { state: 'completed' } })
    expect(operations.release(reservation.operation, new Error('late'))).toBe(false)

    const waiter = new AbortController()
    const cancelled = reservation.operation.waitForOutcome(waiter.signal)
    waiter.abort(new DOMException('stop', 'AbortError'))
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    expect(reservation.operation.controller.signal.aborted).toBe(false)
    release()
    await expect(reservation.operation.waitForOutcome(new AbortController().signal)).resolves.toEqual({ state: 'completed' })
  })
})
