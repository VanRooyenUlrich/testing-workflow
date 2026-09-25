import { ContainerRunner, type ProcessRunner } from '../enforcement/containers.js';
import type { CommandDefinition } from '../shared/types.js';
type Kind = 'node' | 'bun' | 'dotnet';
interface Receipt {
    schemaVersion: 1;
    project: string;
    preparedAt: string;
    inputs: Record<string, string>;
    images: {
        configured: string;
        localId: string;
        preparedId: string;
        kind: Kind;
    }[];
    commands: {
        id: string;
        definitionHash: string;
        outputHash: string;
        runtimeImage: string;
    }[];
}
export declare function prepareToolchain(root: string, projectId: string, runner?: ProcessRunner, container?: ContainerRunner): Promise<Receipt>;
export declare function verifyToolchain(root: string, projectId: string, runner?: ProcessRunner): Promise<{
    ready: true;
    receipt: Receipt;
}>;
export declare function resolvePreparedCommand(root: string, projectId: string, id: string, definition: CommandDefinition, runner?: ProcessRunner): Promise<CommandDefinition>;
export {};
//# sourceMappingURL=toolchain.d.ts.map