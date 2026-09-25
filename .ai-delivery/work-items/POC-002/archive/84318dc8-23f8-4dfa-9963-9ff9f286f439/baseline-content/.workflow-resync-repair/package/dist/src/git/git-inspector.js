import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
async function git(cwd, args) {
    const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
    return stdout.trimEnd();
}
export class GitInspector {
    cwd;
    constructor(cwd) {
        this.cwd = cwd;
    }
    async repositoryRoot() { return git(this.cwd, ['rev-parse', '--show-toplevel']); }
    async status() { return git(this.cwd, ['status', '--short', '--branch']); }
    async diff() { return git(this.cwd, ['diff', '--no-ext-diff']); }
    async changedFiles() { const output = await git(this.cwd, ['diff', '--name-only', '--no-ext-diff']); return output ? output.split(/\r?\n/) : []; }
    async baselineCommit() { return git(this.cwd, ['rev-parse', 'HEAD']); }
    async fileHistory(file, limit = 20) { return git(this.cwd, ['log', `-${String(limit)}`, '--format=%H %aI %s', '--', file]); }
}
//# sourceMappingURL=git-inspector.js.map