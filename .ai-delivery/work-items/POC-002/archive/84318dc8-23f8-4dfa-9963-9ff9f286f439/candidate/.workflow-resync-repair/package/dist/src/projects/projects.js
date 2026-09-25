import { isAbsolute, relative, resolve, sep } from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import { invariant } from '../shared/errors.js';
function normalizedRelative(gitRoot, projectPath) {
    const absolute = resolve(gitRoot, projectPath);
    const rel = relative(resolve(gitRoot), absolute);
    invariant(rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)), `Project path is outside Git root: ${projectPath}`, 'PROJECT_OUTSIDE_ROOT');
    return rel === '' ? '.' : rel.split(sep).join('/');
}
function owns(parent, child) {
    return parent === '.' || child.startsWith(`${parent}/`);
}
export function createProjectRegistry(gitRoot, entries) {
    invariant(entries.length > 0, 'At least one project is required', 'PROJECT_REQUIRED');
    const projects = entries.map((entry) => ({ id: entry.id.trim(), path: normalizedRelative(gitRoot, entry.path) }));
    invariant(projects.every((entry) => /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(entry.id)), 'Invalid project identifier', 'PROJECT_ID_INVALID');
    invariant(new Set(projects.map((entry) => entry.id)).size === projects.length, 'Duplicate project identifier', 'PROJECT_ID_DUPLICATE');
    invariant(new Set(projects.map((entry) => entry.path.toLowerCase())).size === projects.length, 'Overlapping project ownership', 'PROJECT_OVERLAP');
    const sorted = [...projects].sort((a, b) => a.path.localeCompare(b.path));
    for (let left = 0; left < sorted.length; left += 1) {
        for (let right = left + 1; right < sorted.length; right += 1) {
            invariant(!owns(sorted[left].path, sorted[right].path), `Nested project ownership: ${sorted[left].path} owns ${sorted[right].path}`, 'PROJECT_NESTED');
        }
    }
    return { schemaVersion: 1, projects: projects.sort((a, b) => a.id.localeCompare(b.id)) };
}
export function findProject(registry, id) {
    const project = registry.projects.find((entry) => entry.id === id);
    invariant(project, `Unknown project: ${id}`, 'PROJECT_UNKNOWN');
    return project;
}
export async function validateProjectFilesystem(gitRoot, registry) {
    const root = await realpath(gitRoot);
    const canonical = [];
    for (const project of registry.projects) {
        const target = resolve(gitRoot, project.path);
        const rel = relative(resolve(gitRoot), target);
        let cursor = resolve(gitRoot);
        for (const segment of rel.split(/[\\/]/).filter(Boolean)) {
            cursor = resolve(cursor, segment);
            const info = await lstat(cursor);
            invariant(!info.isSymbolicLink(), `Project path contains a symbolic link or junction: ${project.path}`, 'PROJECT_PATH_LINK');
        }
        const actual = await realpath(target);
        const actualRelative = relative(root, actual);
        invariant(actualRelative === '' || actualRelative !== '..' && !actualRelative.startsWith(`..${sep}`) && !isAbsolute(actualRelative), `Project path escapes Git root through the filesystem: ${project.path}`, 'PROJECT_PATH_OUTSIDE_ROOT');
        canonical.push({ id: project.id, path: process.platform === 'win32' ? actual.toLocaleLowerCase('en-US') : actual });
    }
    for (let left = 0; left < canonical.length; left += 1)
        for (let right = left + 1; right < canonical.length; right += 1) {
            const a = canonical[left];
            const b = canonical[right];
            const nested = (base, target) => { const value = relative(base, target); return value === '' || value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value); };
            invariant(!nested(a.path, b.path) && !nested(b.path, a.path), `Filesystem project ownership overlaps: ${a.id} and ${b.id}`, 'PROJECT_PATH_OVERLAP');
        }
    return registry;
}
//# sourceMappingURL=projects.js.map