import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const guidance = `<!-- ai-delivery-workflow:start -->
# AI delivery workflow

Use the repository-local \`ai-delivery-workflow\` skill and \`.ai-delivery\` governance. Start providers through \`ai-delivery session start\`; use only the generated \`ai-delivery\` MCP tools and stop on policy, drift, stale-state, or capability denial. The nearest application \`AGENTS.md\` remains authoritative for implementation rules.
<!-- ai-delivery-workflow:end -->
`;
async function skillDirectory() {
    const candidates = [new URL('../../../skills/ai-delivery-workflow/', import.meta.url), new URL('../../skills/ai-delivery-workflow/', import.meta.url)];
    for (const candidate of candidates)
        try {
            await access(new URL('SKILL.md', candidate));
            return fileURLToPath(candidate);
        }
        catch { /* Try source and compiled layouts. */ }
    throw new Error('Bundled ai-delivery-workflow skill is missing');
}
async function skillFiles(directory, relative = '') {
    const result = [];
    for (const entry of (await readdir(join(directory, relative), { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
        const path = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory())
            result.push(...await skillFiles(directory, path));
        else if (entry.isFile())
            result.push({ relativePath: path, value: await readFile(join(directory, ...path.split('/')), 'utf8') });
    }
    return result;
}
export async function integrationTemplates() {
    const entrypoint = 'node_modules/ai-delivery-workflow/dist/src/cli/main.js';
    const mcp = { mcpServers: { 'ai-delivery': { command: 'node', args: [entrypoint, 'mcp', 'serve', '--session-env'] } } };
    const hook = (phase) => ({ type: 'command', command: `node "${entrypoint}" hook ${phase} --session-env`, timeout: 15 });
    const templates = [
        { relativePath: 'AGENTS.md', format: 'text', kind: 'agent-guidance', strategy: 'agent-guidance', value: guidance },
        { relativePath: '.mcp.json', format: 'json', kind: 'provider-integration', strategy: 'json-merge', value: mcp },
        { relativePath: '.codex/config.toml', format: 'text', kind: 'provider-integration', strategy: 'toml-section', value: `[mcp_servers.ai-delivery]\ncommand = "node"\nargs = ["${entrypoint}", "mcp", "serve", "--session-env"]\nrequired = true\n` },
        { relativePath: '.vscode/mcp.json', format: 'json', kind: 'provider-integration', strategy: 'json-merge', value: { servers: { 'ai-delivery': { type: 'stdio', command: 'node', args: [entrypoint, 'mcp', 'serve', '--session-env'] } } } },
        { relativePath: '.vscode/ai-delivery-hooks.json', format: 'json', kind: 'provider-integration', strategy: 'json-merge', value: { hooks: { PreToolUse: [hook('pre')], PostToolUse: [hook('post')] } } },
        { relativePath: '.claude/settings.json', format: 'json', kind: 'provider-integration', strategy: 'json-merge', value: { permissions: { defaultMode: 'dontAsk', allow: ['mcp__ai-delivery__*'], deny: ['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent'] }, hooks: { PreToolUse: [{ matcher: '*', hooks: [hook('pre')] }], PostToolUse: [{ matcher: '*', hooks: [hook('post')] }] } } },
    ];
    for (const file of await skillFiles(await skillDirectory())) {
        for (const root of ['.agents/skills/ai-delivery-workflow', '.claude/skills/ai-delivery-workflow'])
            templates.push({ relativePath: `${root}/${file.relativePath}`, format: 'text', kind: 'workflow-skill', strategy: 'replace', value: file.value });
    }
    return templates;
}
//# sourceMappingURL=integrations.js.map