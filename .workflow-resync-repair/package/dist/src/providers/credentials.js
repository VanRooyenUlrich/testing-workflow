import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { invariant } from '../shared/errors.js';
import { readJson, withFileLock, writeJsonAtomic } from '../shared/fs.js';
import { parseCredentialVault } from '../schemas/validation.js';
function powershell(script, input) {
    return new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += String(chunk); });
        child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += String(chunk); });
        child.once('error', reject);
        child.once('exit', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `PowerShell exited ${code}`)));
        child.stdin.end(input, 'utf8');
    });
}
const protectScript = "$plain=[Console]::In.ReadToEnd(); $secure=ConvertTo-SecureString -String $plain -AsPlainText -Force; ConvertFrom-SecureString -SecureString $secure";
const unprotectScript = "$cipher=[Console]::In.ReadToEnd(); $secure=ConvertTo-SecureString -String $cipher; $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try {[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}";
export class CredentialStore {
    path;
    constructor(localAppData = process.env.LOCALAPPDATA) {
        invariant(process.platform === 'win32' && localAppData, 'Windows protected credential storage is required', 'CREDENTIAL_STORE_UNAVAILABLE');
        this.path = join(localAppData, 'ai-delivery-workflow', 'credentials.json');
    }
    async read() { try {
        return parseCredentialVault(await readJson(this.path));
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return { schemaVersion: 1, entries: {} };
        throw error;
    } }
    async set(provider, secret) {
        invariant(secret.trim().length >= 8 && !secret.includes('\0'), 'Credential is empty or invalid', 'CREDENTIAL_INVALID');
        await withFileLock(`${this.path}.lock`, async () => { const vault = await this.read(); vault.entries[provider] = { protectedValue: await powershell(protectScript, secret), updatedAt: new Date().toISOString() }; await mkdir(dirname(this.path), { recursive: true, mode: 0o700 }); await writeJsonAtomic(this.path, vault); });
    }
    async get(provider) { const entry = (await this.read()).entries[provider]; invariant(entry, `No protected ${provider} API credential is configured`, 'CREDENTIAL_MISSING'); return powershell(unprotectScript, entry.protectedValue); }
    async status() { const entries = (await this.read()).entries; return { codex: entries.codex !== undefined, claude: entries.claude !== undefined }; }
}
//# sourceMappingURL=credentials.js.map