import type { CommandDefinition } from '../shared/types.js';
export interface DetectionResult {
    gitRoot: string;
    packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'dotnet' | 'unknown';
    nodeVersion: string;
    dotnetVersion: string | null;
    candidateApplications: string[];
    commands: Record<string, CommandDefinition>;
    applicationCommands: Record<string, Record<string, CommandDefinition>>;
    existing: {
        agents: string[];
        aiDelivery: string[];
        skills: string[];
        ideOrMcp: string[];
    };
}
export type ToolchainKind = 'node' | 'bun' | 'dotnet';
export interface ToolchainImage {
    image: string;
    nodeModulesPath?: string;
}
export type ToolchainConfiguration = Partial<Record<ToolchainKind, ToolchainImage>>;
export declare function validateToolchainConfiguration(toolchains: ToolchainConfiguration): void;
export declare function requiredToolchains(commands: Record<string, CommandDefinition>): ToolchainKind[];
export declare function detectCommands(directory: string, detectedManager: DetectionResult['packageManager'], toolchains?: ToolchainConfiguration): Promise<Record<string, CommandDefinition>>;
export declare function detectProject(cwd: string, toolchains?: ToolchainConfiguration): Promise<DetectionResult>;
//# sourceMappingURL=detection.d.ts.map