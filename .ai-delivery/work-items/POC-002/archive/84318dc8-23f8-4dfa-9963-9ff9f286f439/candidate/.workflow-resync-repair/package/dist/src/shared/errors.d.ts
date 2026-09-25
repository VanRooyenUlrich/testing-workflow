export declare class WorkflowError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
export declare function invariant(condition: unknown, message: string, code: string): asserts condition;
//# sourceMappingURL=errors.d.ts.map