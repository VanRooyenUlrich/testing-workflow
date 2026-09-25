export interface ReferenceClientResult {
    protocolVersion: string;
    tools: string[];
    call?: unknown;
    reconnects: number;
}
export declare function runReferenceClient(entrypoint: string, session: string, options?: {
    call?: {
        name: string;
        arguments: Record<string, unknown>;
    };
    reconnect?: boolean;
}): Promise<ReferenceClientResult>;
//# sourceMappingURL=reference-client.d.ts.map