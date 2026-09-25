import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { defaultGovernance } from './defaults.js';
import { detectCommands, detectProject, requiredToolchains } from './detection.js';
import { createProjectRegistry } from '../projects/projects.js';
import { hashObject, sha256, stableJson } from '../shared/hash.js';
import { withFileLock, writeJsonAtomic, writeTextAtomic } from '../shared/fs.js';
import { invariant } from '../shared/errors.js';
import { integrationTemplates } from './integrations.js';
function isObject(value) { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function same(left, right) { return stableJson(left) === stableJson(right); }
function mergeJson(current, addition, path = '$') {
    if (isObject(current) && isObject(addition)) {
        const value = { ...current };
        const conflicts = [];
        for (const [key, proposed] of Object.entries(addition)) {
            if (!(key in current))
                value[key] = proposed;
            else {
                const merged = mergeJson(current[key], proposed, `${path}.${key}`);
                value[key] = merged.value;
                conflicts.push(...merged.conflicts);
            }
        }
        return { value, conflicts };
    }
    if (Array.isArray(current) && Array.isArray(addition)) {
        const currentArray = current;
        const additionArray = addition;
        if (path.endsWith('.args') && !same(currentArray, additionArray))
            return { value: additionArray, conflicts: [path] };
        return { value: [...currentArray, ...additionArray.filter((candidate) => !currentArray.some((entry) => same(entry, candidate)))], conflicts: [] };
    }
    if (same(current, addition))
        return { value: current, conflicts: [] };
    return { value: addition, conflicts: [path] };
}
function formatJsonLike(content, value) {
    const newline = content.includes('\r\n') ? '\r\n' : '\n';
    if (!content.includes('\n'))
        return JSON.stringify(value);
    const indentation = /\n(\s+)\S/.exec(content)?.[1] ?? '  ';
    return `${JSON.stringify(value, null, indentation)}\n`.replaceAll('\n', newline);
}
const guidanceStart = '<!-- ai-delivery-workflow:start -->';
const guidanceEnd = '<!-- ai-delivery-workflow:end -->';
const legacyGuidance = '# AI delivery workflow\n\nUse the repository-local `ai-delivery-workflow` skill and `.ai-delivery` governance. Start providers through `ai-delivery session start`; use only the generated `ai-delivery` MCP tools and stop on policy, drift, stale-state, or capability denial. The nearest application `AGENTS.md` remains authoritative for implementation rules.\n';
function occurrences(content, needle) { const result = []; let from = 0; while ((from = content.indexOf(needle, from)) >= 0) {
    result.push(from);
    from += needle.length;
} return result; }
function mergeGuidance(current, proposed) {
    if (current === proposed || current.includes(proposed.trim()))
        return { content: current, conflicts: [], forceable: true };
    if (current.includes(legacyGuidance))
        return { content: current.replace(legacyGuidance, proposed), conflicts: [], forceable: true };
    const starts = occurrences(current, guidanceStart);
    const ends = occurrences(current, guidanceEnd);
    if (starts.length === 0 && ends.length === 0) {
        const separator = current.length === 0 ? '' : current.endsWith('\n\n') ? '' : current.endsWith('\n') ? '\n' : '\n\n';
        return { content: `${current}${separator}${proposed}`, conflicts: [], forceable: true };
    }
    if (starts.length !== 1 || ends.length !== 1 || starts[0] > ends[0])
        return { content: current, conflicts: ['managed guidance markers require manual repair'], forceable: false };
    const end = ends[0] + guidanceEnd.length;
    const suffix = current.slice(end).startsWith('\n') ? current.slice(end + 1) : current.slice(end);
    return { content: `${current.slice(0, starts[0])}${proposed}${suffix}`, conflicts: ['managed guidance block'], forceable: true };
}
function mergeTomlSection(current, proposed) {
    const newline = current.includes('\r\n') ? '\r\n' : '\n';
    const hadFinalNewline = current.endsWith('\n');
    const lines = current.replaceAll('\r\n', '\n').split('\n');
    if (hadFinalNewline)
        lines.pop();
    const desired = proposed.trim().split('\n');
    const headers = lines.map((line, index) => /^\s*\[mcp_servers\.ai-delivery\]\s*$/.test(line) ? index : -1).filter((index) => index >= 0);
    if (headers.length === 0) {
        const separator = lines.length > 0 && lines.at(-1)?.trim() !== '' ? [''] : [];
        return { content: [...lines, ...separator, ...desired].join(newline) + newline, conflicts: [], forceable: true };
    }
    if (headers.length > 1)
        return { content: current, conflicts: ['duplicate [mcp_servers.ai-delivery] sections'], forceable: false };
    const start = headers[0];
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1)
        if (/^\s*\[[^\]]+\]\s*$/.test(lines[index])) {
            end = index;
            break;
        }
    const conflicts = [];
    const candidate = [...lines];
    let insertion = end;
    for (const desiredLine of desired.slice(1)) {
        const key = /^\s*([A-Za-z0-9_-]+)\s*=/.exec(desiredLine)?.[1];
        if (!key)
            continue;
        const matches = [];
        for (let index = start + 1; index < insertion; index += 1)
            if (new RegExp(`^\\s*${key}\\s*=`).test(candidate[index]))
                matches.push(index);
        if (matches.length === 0) {
            candidate.splice(insertion, 0, desiredLine);
            insertion += 1;
        }
        else if (matches.length > 1)
            return { content: current, conflicts: [`duplicate ${key} assignments`], forceable: false };
        else if (candidate[matches[0]].trim() !== desiredLine.trim()) {
            candidate[matches[0]] = desiredLine;
            conflicts.push(`mcp_servers.ai-delivery.${key}`);
        }
    }
    return { content: candidate.join(newline) + (hadFinalNewline ? newline : ''), conflicts, forceable: true };
}
function unifiedPatch(path, current, proposed) {
    const before = current.replaceAll('\r\n', '\n').split('\n');
    const after = proposed.replaceAll('\r\n', '\n').split('\n');
    if (before.at(-1) === '')
        before.pop();
    if (after.at(-1) === '')
        after.pop();
    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix])
        prefix += 1;
    let suffix = 0;
    while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix])
        suffix += 1;
    const contextStart = Math.max(0, prefix - 3);
    const beforeEnd = Math.min(before.length, before.length - suffix + 3);
    const afterEnd = Math.min(after.length, after.length - suffix + 3);
    const oldLines = before.slice(contextStart, beforeEnd);
    const newLines = after.slice(contextStart, afterEnd);
    const unchangedPrefix = prefix - contextStart;
    const unchangedSuffix = Math.min(3, suffix);
    const body = [
        ...oldLines.slice(0, unchangedPrefix).map((line) => ` ${line}`),
        ...oldLines.slice(unchangedPrefix, oldLines.length - unchangedSuffix).map((line) => `-${line}`),
        ...newLines.slice(unchangedPrefix, newLines.length - unchangedSuffix).map((line) => `+${line}`),
        ...oldLines.slice(oldLines.length - unchangedSuffix).map((line) => ` ${line}`),
    ];
    const normalized = path.replaceAll('\\', '/');
    const oldStart = before.length === 0 ? 0 : contextStart + 1;
    const newStart = after.length === 0 ? 0 : contextStart + 1;
    return `--- a/${normalized}\n+++ b/${normalized}\n@@ -${oldStart},${oldLines.length} +${newStart},${newLines.length} @@\n${body.join('\n')}\n`;
}
function serialize(proposed) { return proposed.format === 'json' ? `${JSON.stringify(proposed.value, null, 2)}\n` : proposed.value; }
async function planFile(root, path, proposed) {
    let current;
    try {
        current = await readFile(path, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            const content = serialize(proposed);
            return { operation: { path, action: 'CREATE', kind: proposed.kind, targetContentSha256: sha256(content) }, content, forceable: true, proposed };
        }
        throw error;
    }
    const currentContentSha256 = sha256(current);
    const relativePath = relative(root, path);
    if (proposed.strategy === 'replace') {
        const equal = proposed.format === 'json' ? (() => { try {
            return stableJson(JSON.parse(current)) === stableJson(proposed.value);
        }
        catch {
            return false;
        } })() : current === proposed.value;
        if (equal)
            return { operation: { path, action: 'UNCHANGED', kind: proposed.kind, currentContentSha256, targetContentSha256: currentContentSha256 }, forceable: true, proposed };
        const content = serialize(proposed);
        return { operation: { path, action: 'SKIP_DIVERGENT', kind: proposed.kind, currentContentSha256, targetContentSha256: sha256(content), patch: unifiedPatch(relativePath, current, content) }, forceContent: content, forceable: true, proposed };
    }
    let result;
    if (proposed.strategy === 'json-merge') {
        try {
            const merged = mergeJson(JSON.parse(current), proposed.value);
            result = { content: formatJsonLike(current, merged.value), conflicts: merged.conflicts, forceable: true };
        }
        catch {
            result = { content: serialize(proposed), conflicts: ['invalid JSON requires manual merge'], forceable: false };
        }
    }
    else if (proposed.strategy === 'agent-guidance')
        result = mergeGuidance(current, proposed.value);
    else
        result = mergeTomlSection(current, proposed.value);
    if (result.content === current) {
        if (result.conflicts.length === 0)
            return { operation: { path, action: 'UNCHANGED', kind: proposed.kind, currentContentSha256, targetContentSha256: currentContentSha256 }, forceable: result.forceable, proposed };
        const suggested = serialize(proposed);
        return { operation: { path, action: 'REVIEW_PATCH', kind: proposed.kind, currentContentSha256, targetContentSha256: sha256(suggested), conflicts: result.conflicts, patch: unifiedPatch(relativePath, current, suggested) }, forceable: false, proposed };
    }
    const operation = { path, action: result.conflicts.length ? 'REVIEW_PATCH' : 'MERGE', kind: proposed.kind, currentContentSha256, targetContentSha256: sha256(result.content), patch: unifiedPatch(relativePath, current, result.content), ...(result.conflicts.length ? { conflicts: result.conflicts } : {}) };
    return { operation, ...(result.conflicts.length ? { forceContent: result.content } : { content: result.content }), forceable: result.forceable, proposed };
}
export async function initialize(options) {
    const toolchains = options.toolchains ?? {};
    const detection = await detectProject(options.cwd, toolchains);
    const registry = createProjectRegistry(detection.gitRoot, options.projects);
    const proposed = new Map();
    const registryPath = join(detection.gitRoot, '.ai-delivery', 'projects.json');
    proposed.set(registryPath, { value: registry, format: 'json', kind: 'project-registry', strategy: 'replace' });
    proposed.set(join(detection.gitRoot, '.ai-delivery', 'runtime.json'), { value: options.runtime ?? { schemaVersion: 1, providers: { 'generic-mcp': {} } }, format: 'json', kind: 'runtime-settings', strategy: 'replace' });
    for (const project of registry.projects) {
        const governance = defaultGovernance(project.id);
        governance.commands = await detectCommands(join(detection.gitRoot, project.path === '.' ? '' : project.path), detection.packageManager, toolchains);
        const missing = requiredToolchains(governance.commands).filter((kind) => toolchains[kind] === undefined);
        invariant(missing.length === 0, `Pinned toolchain image required for detected ${missing.join(', ')} commands`, 'INIT_TOOLCHAIN_IMAGE_REQUIRED');
        invariant(Object.values(governance.commands).every((command) => command.isolation !== undefined), 'Every detected command requires isolation settings', 'INIT_COMMAND_ISOLATION_REQUIRED');
        proposed.set(join(detection.gitRoot, project.path === '.' ? '' : project.path, '.ai-delivery', 'governance.json'), { value: governance, format: 'json', kind: 'application-governance', strategy: 'replace' });
    }
    for (const template of await integrationTemplates())
        proposed.set(join(detection.gitRoot, template.relativePath), template);
    const planned = [];
    for (const [path, value] of proposed)
        planned.push(await planFile(detection.gitRoot, path, value));
    const planHash = hashObject(planned.map(({ operation }) => operation));
    invariant(options.acceptedForceHash === undefined || options.acceptedForceHash === planHash, 'Accepted initialization plan hash does not match the exact proposed content', 'INIT_FORCE_PLAN_STALE');
    const operations = planned.map(({ operation, forceable }) => options.acceptedForceHash !== undefined && forceable && ['SKIP_DIVERGENT', 'REVIEW_PATCH'].includes(operation.action) ? { ...operation, action: 'UPDATE_DIVERGENT' } : operation);
    if (!options.dryRun)
        for (let index = 0; index < operations.length; index += 1) {
            const operation = operations[index];
            const plan = planned[index];
            if (operation.action === 'CREATE' || operation.action === 'MERGE' || operation.action === 'UPDATE_DIVERGENT') {
                const content = operation.action === 'UPDATE_DIVERGENT' ? plan.forceContent : plan.content;
                if (content === undefined)
                    continue;
                await withFileLock(`${operation.path}.ai-delivery-init.lock`, async () => {
                    let latest;
                    try {
                        latest = await readFile(operation.path, 'utf8');
                    }
                    catch (error) {
                        if (error.code !== 'ENOENT')
                            throw error;
                    }
                    if (operation.action === 'CREATE')
                        invariant(latest === undefined, `Initialization target appeared after preview: ${operation.path}`, 'INIT_PLAN_STALE');
                    else
                        invariant(latest !== undefined && sha256(latest) === operation.currentContentSha256, `Initialization target changed after preview: ${operation.path}`, 'INIT_PLAN_STALE');
                    if (plan.proposed.format === 'json' && plan.proposed.strategy === 'replace')
                        await writeJsonAtomic(operation.path, plan.proposed.value);
                    else
                        await writeTextAtomic(operation.path, content);
                    invariant(sha256(await readFile(operation.path)) === operation.targetContentSha256, `Initialization output did not match the accepted content: ${operation.path}`, 'INIT_CONTENT_HASH_MISMATCH');
                });
            }
        }
    return { detection, registry, operations, planHash, changed: !options.dryRun && operations.some((operation) => ['CREATE', 'MERGE', 'UPDATE_DIVERGENT'].includes(operation.action)) };
}
//# sourceMappingURL=initialize.js.map