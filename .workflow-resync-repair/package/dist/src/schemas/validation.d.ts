import type { AgentCapabilityManifest, ConfirmationRecord, ProjectGovernance, ProjectRegistry, ReviewRecord, WorkItem } from '../shared/types.js';
import type { SessionRecord } from '../enforcement/session.js';
import type { RuntimeSettings } from '../config/runtime.js';
export declare function parseProjectRegistry(value: unknown): ProjectRegistry;
export declare function parseGovernance(value: unknown): ProjectGovernance;
export declare function parseLegacyGovernance(value: unknown): Record<string, unknown>;
export declare function parseGovernanceV1(value: unknown): Record<string, unknown>;
export declare function parseWorkItem(value: unknown): WorkItem;
export declare function parseWorkItemV1(value: unknown): Record<string, unknown>;
export declare function parseConfirmation(value: unknown): ConfirmationRecord;
export declare function parseCapabilityManifest(value: unknown): AgentCapabilityManifest;
export declare function parseReview(value: unknown): ReviewRecord;
export declare function parseSessionRecord(value: unknown): SessionRecord;
export declare function parseSessionTransaction(value: unknown): Record<string, unknown>;
export declare function parseRuntimeSettings(value: unknown): RuntimeSettings;
export declare function parseCredentialVault(value: unknown): {
    schemaVersion: 1;
    entries: Partial<Record<'codex' | 'claude', {
        protectedValue: string;
        updatedAt: string;
    }>>;
};
export declare function parsePromotionJournal(value: unknown): Record<string, unknown>;
export declare function parseDeliveryReceipt(value: unknown): Record<string, unknown>;
export declare function parseToolchainReceipt(value: unknown): Record<string, unknown>;
export declare function parseLiveAcceptanceReceipt(value: unknown): Record<string, unknown>;
export declare function parseProviderCompatibility(value: unknown): Record<string, unknown>;
export declare function parseProviderPreparationReceipt(value: unknown): Record<string, unknown>;
export declare function parseDockerAcceptanceReceipt(value: unknown): Record<string, unknown>;
export declare function parseUpgradeJournal(value: unknown): Record<string, unknown>;
//# sourceMappingURL=validation.d.ts.map