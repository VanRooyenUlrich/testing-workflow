export interface RuntimeSettings {
    schemaVersion: 1;
    providers: {
        codex?: {
            model: string;
        };
        claude?: {
            model: string;
        };
        copilot?: {
            authentication: 'vscode-login';
        };
        'generic-mcp'?: Record<string, never>;
    };
}
export declare function loadRuntimeSettings(root: string): Promise<RuntimeSettings>;
//# sourceMappingURL=runtime.d.ts.map