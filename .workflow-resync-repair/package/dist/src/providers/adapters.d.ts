import type { SessionRecord } from '../enforcement/session.js';
import { type ProcessRunner } from '../enforcement/containers.js';
import { startModelBroker } from './broker.js';
export declare const providers: readonly ["codex", "claude", "copilot", "generic-mcp"];
export type Provider = typeof providers[number];
export interface ProviderCapabilities {
    installed: boolean;
    compatible: boolean;
    version: string;
    nativeWriteRemoval: boolean;
    shellRemoval: boolean;
    mcpRestriction: boolean;
    hooks: boolean;
    networkBoundary: boolean;
    sandbox: boolean;
    unsupported: string[];
    quality: 'FULL' | 'PARTIAL' | 'INSUFFICIENT';
}
export interface ProviderPreparationReceipt {
    schemaVersion: 1;
    provider: Provider;
    sessionId: string;
    epoch: number;
    role: SessionRecord['role'];
    runtimeHash: string;
    governanceHash: string;
    manifestHash: string;
    entrypoint: string;
    managedFiles: Record<string, string>;
    configurationHash: string;
}
export interface PreparedSession {
    provider: Provider;
    executable: string;
    args: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    files: Record<string, string>;
    configurationHash: string;
    capabilities: ProviderCapabilities;
    requiresEnvironment: boolean;
    sessionDirectory: string;
    entrypoint: string;
    receipt: ProviderPreparationReceipt;
}
export interface AgentProviderAdapter {
    inspectCapabilities(): Promise<ProviderCapabilities>;
    prepareSession(state: SessionRecord, directory: string, entrypoint: string): Promise<PreparedSession>;
    validateConfiguration(prepared: PreparedSession): Promise<void>;
    launch(prepared: PreparedSession): Promise<number>;
    launchEphemeral(state: SessionRecord, controlDirectory: string, entrypoint: string): Promise<number>;
    cleanup(): Promise<void>;
}
export type ProviderProcessLauncher = (prepared: Omit<PreparedSession, 'sessionDirectory' | 'entrypoint' | 'receipt'>) => Promise<number>;
export type BrokerStarter = typeof startModelBroker;
export type CredentialReader = (provider: 'codex' | 'claude') => Promise<string>;
/** Flags must be found in the installed binary; version strings are informational, not proof. */
export declare class ProviderAdapter implements AgentProviderAdapter {
    readonly provider: Provider;
    private readonly runner;
    private readonly platform;
    private readonly localAppData;
    private readonly processLauncher;
    private readonly brokerStarter;
    private readonly credentialReader;
    private broker?;
    constructor(provider: Provider, runner?: ProcessRunner, platform?: NodeJS.Platform, localAppData?: string | undefined, processLauncher?: ProviderProcessLauncher, brokerStarter?: BrokerStarter, credentialReader?: CredentialReader);
    private command;
    inspectCapabilities(): Promise<ProviderCapabilities>;
    static readiness(provider: Provider, capability: ProviderCapabilities): {
        status: 'PASS' | 'FAIL' | 'WARN';
        message: string;
    };
    private build;
    private verifyReceipt;
    prepareSession(state: SessionRecord, directory: string, entrypoint: string): Promise<PreparedSession>;
    validateConfiguration(prepared: PreparedSession): Promise<void>;
    private runtimePrepared;
    private spawnPrepared;
    launch(prepared: PreparedSession): Promise<number>;
    launchEphemeral(state: SessionRecord, controlDirectory: string, entrypoint: string): Promise<number>;
    launchAttachedContainer(containerName: string, directory: string): Promise<number>;
    cleanup(): Promise<void>;
}
export declare function withSessionLaunchLock<T>(directory: string, operation: () => Promise<T>): Promise<T>;
//# sourceMappingURL=adapters.d.ts.map