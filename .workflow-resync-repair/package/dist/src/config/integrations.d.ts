export type IntegrationStrategy = 'json-merge' | 'agent-guidance' | 'toml-section' | 'replace';
export interface IntegrationTemplate {
    relativePath: string;
    format: 'json' | 'text';
    value: unknown;
    kind: 'agent-guidance' | 'provider-integration' | 'workflow-skill';
    strategy: IntegrationStrategy;
}
export declare function integrationTemplates(): Promise<IntegrationTemplate[]>;
//# sourceMappingURL=integrations.d.ts.map