import { runProcess, credentialFreeEnvironment } from '../enforcement/containers.js';
import { statusOpa } from '../enforcement/opa-runtime.js';
import { ProviderAdapter, providers } from '../providers/adapters.js';
import { WorkflowRepository } from '../work-items/repository.js';
import { loadRuntimeSettings } from './runtime.js';
import { verifyToolchain } from './toolchain.js';
import { CredentialStore } from '../providers/credentials.js';
export function formatDoctorReport(report) {
    const lines = [`AI Delivery Workflow doctor: ${report.ready ? 'READY' : 'NOT READY'}`, `Repository: ${report.root}`, ''];
    for (const check of report.checks) {
        lines.push(`[${check.status}] ${check.id}: ${check.message}`);
        if (check.remediation && check.status !== 'PASS')
            lines.push(`  Next: ${check.remediation}`);
    }
    return `${lines.join('\n')}\n`;
}
export async function doctor(root) {
    const checks = [];
    checks.push({ id: 'node', status: Number(process.versions.node.split('.')[0]) >= 22 ? 'PASS' : 'FAIL', message: `Node.js ${process.versions.node}`, remediation: 'Install Node.js 22 or newer.' });
    try {
        const result = await runProcess('git', ['--version'], { timeout: 10000, env: credentialFreeEnvironment() });
        checks.push({ id: 'git', status: 'PASS', message: result.stdout.trim() });
    }
    catch {
        checks.push({ id: 'git', status: 'FAIL', message: 'Git is unavailable.', remediation: 'Install Git for Windows and reopen the terminal.' });
    }
    try {
        const repository = new WorkflowRepository(root);
        const registry = await repository.loadRegistry();
        for (const project of registry.projects) {
            const governance = await repository.loadGovernance(project.id);
            if (Object.keys(governance.commands).length)
                try {
                    await verifyToolchain(root, project.id);
                    checks.push({ id: `toolchain:${project.id}`, status: 'PASS', message: 'Pinned toolchain receipt matches project declarations and local images.' });
                }
                catch (error) {
                    checks.push({ id: `toolchain:${project.id}`, status: 'FAIL', message: String(error.message), remediation: `Run ai-delivery toolchain prepare --project ${project.id}.` });
                }
        }
        checks.push({ id: 'configuration', status: 'PASS', message: `${registry.projects.length} governed project(s) passed strict ownership validation.` });
    }
    catch (error) {
        checks.push({ id: 'configuration', status: 'FAIL', message: String(error.message), remediation: 'Run ai-delivery init and review the generated plan.' });
    }
    try {
        const result = await runProcess('docker', ['info', '--format', '{{.OSType}}/{{.Architecture}}'], { timeout: 15000, env: credentialFreeEnvironment() });
        const linux = result.stdout.trim().startsWith('linux/');
        checks.push({ id: 'docker', status: linux ? 'PASS' : 'FAIL', message: result.stdout.trim(), remediation: 'Start Docker Desktop and select the Linux container engine.' });
    }
    catch {
        checks.push({ id: 'docker', status: 'FAIL', message: 'Docker Desktop Linux engine is unavailable.', remediation: 'Start Docker Desktop and wait for the Linux engine.' });
    }
    const opa = await statusOpa();
    checks.push({ id: 'policy', status: opa.ready && opa.image === OPA_IMAGE ? 'PASS' : 'FAIL', message: opa.exists ? `running=${opa.running}, ready=${opa.ready}, image=${opa.image}` : 'OPA is not running.', remediation: 'Run ai-delivery policy start.' });
    let selected = new Set(['generic-mcp']);
    try {
        selected = new Set(Object.keys((await loadRuntimeSettings(root)).providers));
    }
    catch {
        checks.push({ id: 'runtime', status: 'FAIL', message: 'Runtime settings are missing or invalid.', remediation: 'Run ai-delivery init and review the runtime settings plan.' });
    }
    let credentials = { codex: false, claude: false };
    try {
        credentials = await new CredentialStore().status();
    }
    catch { /* Report selected credential failures below. */ }
    for (const provider of providers) {
        if (!selected.has(provider))
            continue;
        const capability = await new ProviderAdapter(provider).inspectCapabilities();
        const readiness = ProviderAdapter.readiness(provider, capability);
        checks.push({ id: `provider:${provider}`, status: readiness.status, message: readiness.message, ...(readiness.status === 'FAIL' ? { remediation: `Install/configure ${provider}, then rerun doctor.` } : {}) });
        if ((provider === 'codex' || provider === 'claude') && !credentials[provider])
            checks.push({ id: `credential:${provider}`, status: 'FAIL', message: `Protected ${provider} API credential is missing.`, remediation: `Pipe the dedicated key to ai-delivery credentials set ${provider} --stdin.` });
        if (provider === 'copilot' && capability.installed)
            checks.push({ id: 'authentication:copilot', status: 'WARN', message: 'Copilot sign-in cannot be proven without launching the isolated VS Code profile.', remediation: 'Launch a governed Copilot session, sign in through VS Code, and record the live acceptance result.' });
    }
    return { ready: checks.every((entry) => entry.status !== 'FAIL'), root, checks };
}
import { OPA_IMAGE } from '../enforcement/opa-runtime.js';
//# sourceMappingURL=doctor.js.map