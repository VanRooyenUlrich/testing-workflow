export declare class GitInspector {
    private readonly cwd;
    constructor(cwd: string);
    repositoryRoot(): Promise<string>;
    status(): Promise<string>;
    diff(): Promise<string>;
    changedFiles(): Promise<string[]>;
    baselineCommit(): Promise<string>;
    fileHistory(file: string, limit?: number): Promise<string>;
}
//# sourceMappingURL=git-inspector.d.ts.map