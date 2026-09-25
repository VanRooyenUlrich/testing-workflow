export declare const requiredDockerAcceptanceCheckIds: readonly ["docker-linux-engine", "build-generic", "build-codex", "build-claude", "build-copilot", "restricted-runtime-generic", "restricted-runtime-codex", "restricted-runtime-claude", "restricted-runtime-copilot", "codex-version", "claude-version", "validation-offline", "isolated-review-generic-mcp", "vscode-home-writable"];
export declare function validateDockerAcceptanceChecks(checks: unknown): void;
export declare function verifyAnnotatedTag(objectType: string | undefined, peeledTarget: string | undefined, head: string): {
    valid: boolean;
    detail: string;
};
//# sourceMappingURL=release.d.ts.map