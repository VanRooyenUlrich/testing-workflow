import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

const local = resolve('.verification', process.platform === 'win32' ? 'opa.exe' : 'opa');
let executable = process.env.OPA_BIN || local;
try { await access(executable); } catch { executable = 'opa'; }

const child = spawn(executable, ['test', 'policy', '-v'], { stdio: 'inherit', windowsHide: true, shell: false });
child.once('error', (error) => {
  process.stderr.write(`Unable to run OPA. Set OPA_BIN or place the binary at ${local}: ${error.message}\n`);
  process.exitCode = 1;
});
child.once('exit', (code) => { process.exitCode = code ?? 1; });
