import { throwMinerU } from '../domain/errors.js'

export class StorageAccessGate {
  private activeReaders = 0
  private exclusive = false

  get activeReaderCount(): number { return this.activeReaders }

  async runShared<T>(operation: () => Promise<T>): Promise<T> {
    if (this.exclusive) {
      throwMinerU('STORAGE_LOCKED', 'MinerU storage maintenance is in progress')
    }
    this.activeReaders++
    try {
      return await operation()
    } finally {
      this.activeReaders--
    }
  }

  tryAcquireExclusive(): (() => void) | undefined {
    if (this.exclusive || this.activeReaders > 0) return undefined
    this.exclusive = true
    let released = false
    return () => {
      if (released) return
      released = true
      this.exclusive = false
    }
  }
}
