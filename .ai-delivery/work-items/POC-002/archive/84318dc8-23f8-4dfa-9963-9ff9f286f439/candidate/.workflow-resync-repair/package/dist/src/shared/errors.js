export class WorkflowError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = 'WorkflowError';
    }
}
export function invariant(condition, message, code) {
    if (!condition) {
        throw new WorkflowError(message, code);
    }
}
//# sourceMappingURL=errors.js.map