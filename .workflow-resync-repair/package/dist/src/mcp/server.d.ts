import type { Readable, Writable } from 'node:stream';
import { type PolicyGateway } from '../enforcement/gateway.js';
export declare class DeliveryMcpServer {
    readonly gateway: PolicyGateway;
    constructor(gateway: PolicyGateway);
    tools(): Promise<{
        name: string;
        description: string;
        inputSchema: {
            type: string;
            properties: {
                [k: string]: {
                    type: string[];
                    enum?: never;
                    maxLength?: never;
                } | {
                    type: string;
                    enum: string[];
                    maxLength?: never;
                } | {
                    type: string;
                    maxLength: number;
                    enum?: never;
                };
            };
            required: string[];
            additionalProperties: boolean;
        };
    }[]>;
    call(name: string, raw: unknown): Promise<unknown>;
    request(raw: unknown): Promise<Record<string, unknown> | undefined>;
    serve(input: Readable, output: Writable): Promise<void>;
}
//# sourceMappingURL=server.d.ts.map