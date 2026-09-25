export declare const PACKAGE_VERSION = "1.0.0";
export declare const DATA_SCHEMA_VERSION = 2;
export declare const GOVERNANCE_VERSION = 2;
export declare const SUPPORTED_GOVERNANCE_VERSIONS: readonly [0, 1, 2];
export declare const SUPPORTED_DATA_SCHEMA_VERSIONS: readonly [1, 2];
export interface WorkflowFormatVersion {
    package: string;
    governance: number;
    schema: number;
}
export declare function parseWorkflowVersion(value: string): WorkflowFormatVersion;
export declare function workflowVersion(governanceVersion?: number): string;
//# sourceMappingURL=versions.d.ts.map