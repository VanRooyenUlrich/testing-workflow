import type { PolicyGateway } from './gateway.js';
/** Deliberately constructs a new bundle; no transcript path or conversation is accepted. */
export declare function contextBundle(gateway: PolicyGateway, kind: 'implementation' | 'review'): Promise<{
    artifactHash: string;
    finalDiff?: {
        path: string;
        before: string | null;
        after: string | null;
        diff: string;
    }[];
    validation?: {
        snapshotHash: string;
        governanceHash: string;
        passed: boolean;
        commands: string[];
        changedPaths?: string[];
        commandResults?: import("./session.js").CommandReceipt[];
        resultHash?: string;
        validatedAt?: string;
    } | null;
    handoff?: {
        contentHash: string;
        snapshotHash: string;
        governanceHash: string;
        manifestHash: string;
        submittedAt: string;
        content: string;
    };
    boundary: "review" | "implementation";
    workItem: string;
    project: string;
    artifacts: Record<string, string>;
    governanceHash: string;
    capabilities: import("../index.js").AgentCapabilityManifest;
    readOnly: boolean;
}>;
//# sourceMappingURL=context.d.ts.map