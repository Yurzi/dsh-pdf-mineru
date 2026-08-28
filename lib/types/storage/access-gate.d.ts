export declare class StorageAccessGate {
    private activeReaders;
    private exclusive;
    get activeReaderCount(): number;
    runShared<T>(operation: () => Promise<T>): Promise<T>;
    tryAcquireExclusive(): (() => void) | undefined;
}
