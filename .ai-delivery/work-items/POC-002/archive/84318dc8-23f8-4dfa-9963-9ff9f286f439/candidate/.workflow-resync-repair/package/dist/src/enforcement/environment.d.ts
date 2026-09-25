import type { Provider } from '../providers/adapters.js';
import { type ProcessRunner } from './containers.js';
import type { PolicyGateway } from './gateway.js';
export type InteractiveRunner = (args: string[]) => Promise<number>;
export type CopilotContainerLauncher = (container: string, directory: string) => Promise<number>;
export interface IsolatedImplementationResult {
    exitCode: number;
    candidate: string;
}
export interface IsolatedReviewResult {
    exitCode: number;
    reviewSession: string;
    submitted: true;
    confirmationHash: string;
}
/** The supplied digest is an administrator-built image containing this package, OPA and a provider. */
export declare class IsolatedEnvironment {
    private readonly runner;
    private readonly interactive;
    private readonly copilot;
    constructor(runner?: ProcessRunner, interactive?: InteractiveRunner, copilot?: CopilotContainerLauncher);
    private docker;
    private importImplementationHandoff;
    private launchReview;
    launch(gateway: PolicyGateway, provider: Provider, image: string): Promise<IsolatedImplementationResult | IsolatedReviewResult>;
    copyRuntime(destination: string): Promise<void>;
}
//# sourceMappingURL=environment.d.ts.map