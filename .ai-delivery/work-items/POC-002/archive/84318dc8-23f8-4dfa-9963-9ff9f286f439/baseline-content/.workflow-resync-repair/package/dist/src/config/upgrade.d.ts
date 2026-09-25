import type { ProjectGovernance, WorkItem } from '../shared/types.js';
export interface GovernanceUpgrade {
    kind: 'governance' | 'work-item';
    project: string;
    path: string;
    from: string;
    to: string;
    currentHash: string;
    proposedHash: string;
    divergent: boolean;
    action: 'UNCHANGED' | 'MIGRATE';
    migrations: string[];
}
export interface UpgradePlan {
    packageVersion: string;
    schemaVersion: number;
    governanceVersion: number;
    interrupted: boolean;
    operations: GovernanceUpgrade[];
    planHash: string;
}
export interface UpgradeDependencies {
    afterOperation?: (operation: GovernanceUpgrade, index: number) => Promise<void> | void;
}
export declare const governanceMigrations: Readonly<Record<number, (value: Record<string, unknown>) => Record<string, unknown>>>;
export declare function migrateGovernance(value: unknown): {
    governance: ProjectGovernance;
    from: string;
    migrations: string[];
};
export declare function migrateWorkItem(value: unknown): {
    workItem: WorkItem;
    from: string;
    migrations: string[];
};
export declare function inspectUpgrade(root: string): Promise<UpgradePlan>;
export declare function applyUpgrade(root: string, options: {
    dryRun: boolean;
    acceptedPlanHash?: string;
    resume?: boolean;
}, dependencies?: UpgradeDependencies): Promise<UpgradePlan>;
//# sourceMappingURL=upgrade.d.ts.map