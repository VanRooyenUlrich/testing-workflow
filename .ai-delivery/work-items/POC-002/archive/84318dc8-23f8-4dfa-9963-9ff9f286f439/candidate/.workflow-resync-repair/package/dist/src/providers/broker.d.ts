import type { BrokerProvider } from './credentials.js';
export interface BrokerSession {
    baseUrl: string;
    token: string;
    expiresAt: string;
    revoke(): Promise<void>;
}
export interface BrokerOptions {
    provider: BrokerProvider;
    model: string;
    upstreamCredential: string;
    sessionId: string;
    expiresAt: string;
    auditDirectory: string;
    upstreamBaseUrl?: string;
    fetcher?: typeof fetch;
    sessionToken?: string;
    listenHost?: string;
    port?: number;
}
export declare function startModelBroker(options: BrokerOptions): Promise<BrokerSession>;
//# sourceMappingURL=broker.d.ts.map