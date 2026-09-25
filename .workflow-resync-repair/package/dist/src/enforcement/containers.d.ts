import type { CommandDefinition } from '../shared/types.js';
import type { PolicyGateway } from './gateway.js';
export { requirePinnedImage } from '../shared/images.js';
export interface ProcessResult {
    stdout: string;
    stderr: string;
}
export type ProcessRunner = (executable: string, args: string[], options: {
    cwd?: string;
    timeout: number;
    env: NodeJS.ProcessEnv;
}) => Promise<ProcessResult>;
export declare const runProcess: ProcessRunner;
export declare function credentialFreeEnvironment(source?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export declare function domainAllowed(domain: string, allowed: string[]): boolean;
export declare function validateCommand(command: CommandDefinition): NonNullable<CommandDefinition['isolation']>;
/** A Docker volume is seeded by a stopped helper, never by a writable host bind. */
export declare class ContainerRunner {
    private readonly runner;
    readonly requiresPreparedToolchain: boolean;
    constructor(runner?: ProcessRunner);
    private docker;
    execute(command: CommandDefinition, source: string): Promise<{
        exitCode: number;
        outputHash: string;
        stdout: string;
        stderr: string;
    }>;
}
export declare function runGovernedCommand(gateway: PolicyGateway, request: unknown, runner?: ContainerRunner): Promise<{
    exitCode: number;
    outputHash: string;
}>;
//# sourceMappingURL=containers.d.ts.map