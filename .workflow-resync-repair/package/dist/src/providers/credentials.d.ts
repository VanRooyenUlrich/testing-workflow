export type BrokerProvider = 'codex' | 'claude';
export declare class CredentialStore {
    readonly path: string;
    constructor(localAppData?: string | undefined);
    private read;
    set(provider: BrokerProvider, secret: string): Promise<void>;
    get(provider: BrokerProvider): Promise<string>;
    status(): Promise<Record<BrokerProvider, boolean>>;
}
//# sourceMappingURL=credentials.d.ts.map