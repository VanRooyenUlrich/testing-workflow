import { type ProcessRunner } from './containers.js';
export declare const OPA_IMAGE = "openpolicyagent/opa@sha256:46e10721113652fee1f553960cc5a0d96a01164760efc5e9423bbc1cc453b31d";
export declare function startOpa(runner?: ProcessRunner): Promise<string>;
export interface OpaStatus {
    exists: boolean;
    running: boolean;
    ready: boolean;
    image: string;
    policyHash: string;
}
export declare function statusOpa(runner?: ProcessRunner): Promise<OpaStatus>;
export declare function stopOpa(runner?: ProcessRunner): Promise<boolean>;
//# sourceMappingURL=opa-runtime.d.ts.map