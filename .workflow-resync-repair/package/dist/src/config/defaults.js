import { workflowVersion } from './versions.js';
export function defaultGovernance(projectId) {
    return {
        schemaVersion: 2,
        workflowVersion: workflowVersion(),
        projectId,
        allowedPaths: ['**/*'],
        deniedPaths: ['.git/**', '.env', '.env.*', '**/*.pem', '**/*.key'],
        commands: {},
        dataClassification: 'INTERNAL',
        riskRules: [
            { code: 'AUTHORIZATION_CHANGE', source: 'affected-path', profile: 'HIGH_RISK', pathPatterns: ['**/auth/**', '**/authorization/**', '**/permissions/**'] },
            { code: 'CREDENTIAL_HANDLING', source: 'affected-path', profile: 'HIGH_RISK', pathPatterns: ['**/credentials/**', '**/secrets/**'], nonDowngradable: true },
            { code: 'DATABASE_SCHEMA_CHANGE', source: 'affected-path', profile: 'HIGH_RISK', pathPatterns: ['**/migrations/**', '**/schema.sql'] },
            { code: 'INFRASTRUCTURE_CHANGE', source: 'affected-path', profile: 'HIGH_RISK', pathPatterns: ['**/infra/**', '**/*.tf', '**/Dockerfile', '**/.github/workflows/**'] },
            { code: 'PUBLIC_API_CHANGE', source: 'affected-path', profile: 'HIGH_RISK', pathPatterns: ['**/openapi.json', '**/openapi.yaml', '**/openapi.yml', '**/swagger.json', '**/swagger.yaml', '**/swagger.yml', '**/api-contracts/**'] },
            { code: 'NETWORK_REQUIREMENT', source: 'requested-command', profile: 'HIGH_RISK', commandPatterns: ['curl*', 'wget*', 'Invoke-WebRequest*'] },
            { code: 'GOVERNANCE_SECURITY_CHANGE', source: 'affected-path', profile: 'HIGH_RISK', pathPatterns: ['**/.ai-delivery/**', '**/AGENTS.md'], nonDowngradable: true },
        ],
        confirmations: { lightweightSpecification: false, lightweightPlan: false },
        capabilities: { allowedMcpServers: [], allowedMcpOperations: [], lightweightNetworkDomains: [] },
        validation: { requiredCommands: [], policyCommands: [], requirePolicyValidationForHighRisk: true, builtInPolicy: true },
    };
}
//# sourceMappingURL=defaults.js.map