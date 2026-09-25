export interface ParsedArguments {
    positionals: string[];
    flags: Map<string, string[]>;
}
export declare function parseArguments(argv: string[]): ParsedArguments;
export declare function flag(args: ParsedArguments, name: string, required?: boolean): string | undefined;
export declare function flags(args: ParsedArguments, name: string): string[];
export declare function booleanFlag(args: ParsedArguments, name: string): boolean;
//# sourceMappingURL=arguments.d.ts.map