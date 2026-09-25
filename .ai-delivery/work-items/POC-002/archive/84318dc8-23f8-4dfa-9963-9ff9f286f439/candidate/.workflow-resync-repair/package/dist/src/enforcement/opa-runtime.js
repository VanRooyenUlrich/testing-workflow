import { fileURLToPath } from 'node:url';
import { credentialFreeEnvironment, runProcess } from './containers.js';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
// Docker Hub manifest-list digest resolved from the official 1.0.1-static tag, 2026-09-08.
export const OPA_IMAGE = 'openpolicyagent/opa@sha256:46e10721113652fee1f553960cc5a0d96a01164760efc5e9423bbc1cc453b31d';
export async function startOpa(runner = runProcess) {
    const policy = fileURLToPath(new URL('../../../policy', import.meta.url));
    const existing = await statusOpa(runner);
    if (existing.exists) {
        if (!existing.running)
            await runner('docker', ['start', 'ai-delivery-opa'], { timeout: 30000, env: credentialFreeEnvironment() });
        return 'ai-delivery-opa';
    }
    const result = await runner('docker', ['run', '--detach', '--name', 'ai-delivery-opa', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user', '65532:65532', '--cpus', '0.5', '--memory', '128m', '--pids-limit', '64', '--publish', '127.0.0.1:8181:8181', '--mount', `type=bind,source=${policy},target=/policy,readonly`, OPA_IMAGE, 'run', '--server', '--addr=0.0.0.0:8181', '/policy/core.rego'], { timeout: 30000, env: credentialFreeEnvironment() });
    return result.stdout.trim();
}
export async function statusOpa(runner = runProcess) {
    const policyPath = fileURLToPath(new URL('../../../policy/core.rego', import.meta.url));
    const policyHash = createHash('sha256').update(await readFile(policyPath)).digest('hex');
    try {
        const inspected = await runner('docker', ['inspect', '--format', '{{json .State.Running}} {{json .Config.Image}}', 'ai-delivery-opa'], { timeout: 10000, env: credentialFreeEnvironment() });
        const match = /^(true|false)\s+"([^"]+)"/.exec(inspected.stdout.trim());
        const running = match?.[1] === 'true';
        const image = match?.[2] ?? '';
        let ready = false;
        if (running)
            try {
                const response = await fetch('http://127.0.0.1:8181/health', { signal: AbortSignal.timeout(3000) });
                ready = response.ok;
            }
            catch { /* Not ready. */ }
        return { exists: true, running, ready, image, policyHash };
    }
    catch {
        return { exists: false, running: false, ready: false, image: '', policyHash };
    }
}
export async function stopOpa(runner = runProcess) {
    const status = await statusOpa(runner);
    if (!status.exists)
        return false;
    await runner('docker', ['rm', '-f', 'ai-delivery-opa'], { timeout: 30000, env: credentialFreeEnvironment() });
    return true;
}
//# sourceMappingURL=opa-runtime.js.map