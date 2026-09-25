import { join } from 'node:path';
import { readJson } from '../shared/fs.js';
import { parseRuntimeSettings } from '../schemas/validation.js';
export async function loadRuntimeSettings(root) { return parseRuntimeSettings(await readJson(join(root, '.ai-delivery', 'runtime.json'))); }
//# sourceMappingURL=runtime.js.map