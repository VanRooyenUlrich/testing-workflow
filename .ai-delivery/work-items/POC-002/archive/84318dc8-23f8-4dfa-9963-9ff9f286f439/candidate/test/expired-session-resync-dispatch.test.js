import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('session resync dispatches before active-session loading', async () => {
  const source = await readFile(
    new URL('../node_modules/ai-delivery-workflow/dist/src/cli/enforcement.js', import.meta.url),
    'utf8',
  );
  const storeIndex = source.indexOf('const store = new SessionStore');
  const resyncIndex = source.indexOf("if (group === 'session' && action === 'resync')", storeIndex);
  const activeLoadIndex = source.indexOf('const state = await store.load();', storeIndex);
  const resyncOccurrences = source.match(/action === 'resync'/g) ?? [];

  assert.ok(storeIndex >= 0);
  assert.ok(resyncIndex > storeIndex);
  assert.ok(resyncIndex < activeLoadIndex);
  assert.match(source.slice(resyncIndex, activeLoadIndex), /store\.read\(\)/);
  assert.equal(resyncOccurrences.length, 1);
});
