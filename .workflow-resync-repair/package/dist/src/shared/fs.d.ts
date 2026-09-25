export interface FileLockOptions {
    timeoutMs?: number;
    retryMs?: number;
}
/**
 * Runs an operation while holding an atomic, cross-process lock file. Lock files
 * are deliberately not stolen: an interrupted operation must be investigated
 * before its state is changed again.
 */
export declare function withFileLock<T>(path: string, operation: () => Promise<T>, options?: FileLockOptions): Promise<T>;
export declare function readJson(path: string): Promise<unknown>;
export declare function writeJsonAtomic(path: string, value: unknown): Promise<void>;
export declare function writeTextAtomic(path: string, value: string): Promise<void>;
//# sourceMappingURL=fs.d.ts.map