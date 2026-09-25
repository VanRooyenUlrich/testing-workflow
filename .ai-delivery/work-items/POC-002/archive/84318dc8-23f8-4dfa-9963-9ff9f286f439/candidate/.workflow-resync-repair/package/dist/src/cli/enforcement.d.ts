import type { ConfirmationInput } from '../shared/types.js';
import { type ParsedArguments } from './arguments.js';
type Confirm = (prompt: string, expectedHash?: string, reason?: string) => Promise<ConfirmationInput>;
export declare function enforcementCommand(args: ParsedArguments, confirm: Confirm): Promise<boolean>;
export {};
//# sourceMappingURL=enforcement.d.ts.map