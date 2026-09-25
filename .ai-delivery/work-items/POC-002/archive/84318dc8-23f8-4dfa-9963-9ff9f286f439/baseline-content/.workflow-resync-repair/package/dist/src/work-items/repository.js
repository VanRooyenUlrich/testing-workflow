import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readJson, withFileLock, writeJsonAtomic, writeTextAtomic } from '../shared/fs.js';
import { invariant } from '../shared/errors.js';
import { parseGovernance, parseProjectRegistry, parseWorkItem } from '../schemas/validation.js';
import { createProjectRegistry, findProject, validateProjectFilesystem } from '../projects/projects.js';
export class WorkflowRepository {
    gitRoot;
    constructor(gitRoot) {
        this.gitRoot = gitRoot;
    }
    registryPath() { return join(this.gitRoot, '.ai-delivery', 'projects.json'); }
    evidencePath() { return join(this.gitRoot, '.ai-delivery', 'evidence.jsonl'); }
    async exclusiveCommit(operation) { return withFileLock(join(this.gitRoot, '.ai-delivery', 'commit.lock'), operation); }
    workItemDirectory(id) {
        invariant(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id), 'Invalid work-item identifier', 'WORK_ID_INVALID');
        return join(this.gitRoot, '.ai-delivery', 'work-items', id);
    }
    async loadRegistry() {
        const registry = parseProjectRegistry(await readJson(this.registryPath()));
        return validateProjectFilesystem(this.gitRoot, createProjectRegistry(this.gitRoot, registry.projects));
    }
    async saveRegistry(registry) { const parsed = parseProjectRegistry(registry); const validated = await validateProjectFilesystem(this.gitRoot, createProjectRegistry(this.gitRoot, parsed.projects)); await writeJsonAtomic(this.registryPath(), validated); }
    async loadGovernance(projectId) {
        const registry = await this.loadRegistry();
        const project = findProject(registry, projectId);
        const path = join(this.gitRoot, project.path === '.' ? '' : project.path, '.ai-delivery', 'governance.json');
        const governance = parseGovernance(await readJson(path));
        invariant(governance.projectId === projectId, `Governance projectId does not match registry: ${projectId}`, 'GOVERNANCE_PROJECT_MISMATCH');
        return governance;
    }
    workItemPath(id) { return join(this.workItemDirectory(id), 'work-item.json'); }
    async loadWorkItem(id) {
        const workItem = parseWorkItem(await readJson(this.workItemPath(id)));
        invariant(workItem.id === id, `Work-item ID does not match requested path: ${id}`, 'WORK_ID_MISMATCH');
        return workItem;
    }
    async listWorkItems() {
        const directory = join(this.gitRoot, '.ai-delivery', 'work-items');
        let entries;
        try {
            entries = await readdir(directory);
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return [];
            throw error;
        }
        const items = [];
        for (const id of entries.sort()) {
            if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id))
                continue;
            try {
                items.push(await this.loadWorkItem(id));
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
            }
        }
        return items;
    }
    async saveWorkItem(workItem) {
        const expectedRevision = workItem.revision;
        const path = this.workItemPath(workItem.id);
        const saved = await withFileLock(`${path}.lock`, async () => {
            let current;
            try {
                current = parseWorkItem(await readJson(path));
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
            }
            if (current) {
                invariant(current.id === workItem.id, `Work-item ID does not match requested path: ${workItem.id}`, 'WORK_ID_MISMATCH');
                invariant(current.revision === expectedRevision, `Work item ${workItem.id} changed from revision ${expectedRevision} to ${current.revision}`, 'WORK_ITEM_REVISION_CONFLICT');
            }
            else {
                invariant(expectedRevision === 0, `New work item ${workItem.id} must start at revision 0`, 'WORK_ITEM_REVISION_CONFLICT');
            }
            const next = parseWorkItem({ ...workItem, revision: expectedRevision + 1 });
            await writeJsonAtomic(path, next);
            return next;
        });
        workItem.revision = saved.revision;
        return saved;
    }
    async saveWorkItemSnapshot(workItem) {
        const path = this.workItemPath(workItem.id);
        await withFileLock(`${path}.lock`, async () => {
            try {
                await readFile(path, 'utf8');
                invariant(false, `Work item already exists: ${workItem.id}`, 'WORK_EXISTS');
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
            }
            await writeJsonAtomic(path, parseWorkItem(workItem));
        });
    }
    artifactPath(id, type) { return join(this.workItemDirectory(id), `${type}.md`); }
    async writeArtifact(id, type, content) { await writeTextAtomic(this.artifactPath(id, type), content); }
    async readArtifact(id, type) { return readFile(this.artifactPath(id, type), 'utf8'); }
}
//# sourceMappingURL=repository.js.map