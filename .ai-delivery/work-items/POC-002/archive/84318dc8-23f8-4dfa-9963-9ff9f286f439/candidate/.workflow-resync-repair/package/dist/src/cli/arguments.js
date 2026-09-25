import { WorkflowError } from '../shared/errors.js';
export function parseArguments(argv) {
    const positionals = [];
    const flags = new Map();
    for (let index = 0; index < argv.length; index += 1) {
        const value = argv[index];
        if (!value.startsWith('--')) {
            positionals.push(value);
            continue;
        }
        const [rawName, inline] = value.slice(2).split('=', 2);
        const name = rawName;
        const next = argv[index + 1];
        let flagValue = inline;
        if (flagValue === undefined && next !== undefined && !next.startsWith('--')) {
            flagValue = next;
            index += 1;
        }
        const values = flags.get(name) ?? [];
        values.push(flagValue ?? 'true');
        flags.set(name, values);
    }
    return { positionals, flags };
}
export function flag(args, name, required = false) {
    const value = args.flags.get(name)?.at(-1);
    if (required && (value === undefined || value === 'true'))
        throw new WorkflowError(`Missing --${name}`, 'CLI_ARGUMENT_REQUIRED');
    return value;
}
export function flags(args, name) { return args.flags.get(name) ?? []; }
export function booleanFlag(args, name) { return args.flags.has(name) && flag(args, name) !== 'false'; }
//# sourceMappingURL=arguments.js.map