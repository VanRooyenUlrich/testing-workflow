import test from 'node:test';
import assert from 'node:assert/strict';
import { providerCompatibility } from '../node_modules/ai-delivery-workflow/dist/src/providers/compatibility.js';

test('Codex compatibility accepts the configured minimum and higher versions', () => {
  assert.equal(providerCompatibility('codex', '0.150.0').compatible, true);
  assert.equal(providerCompatibility('codex', 'codex-cli 0.155.0').compatible, true);
  assert.equal(providerCompatibility('codex', '1.0.0').compatible, true);
});

test('Codex compatibility rejects versions below the minimum or without a semantic version', () => {
  assert.match(providerCompatibility('codex', '0.149.9').reason, /minimum 0\.150\.0/);
  assert.match(providerCompatibility('codex', 'unknown').reason, /minimum 0\.150\.0/);
});

test('exact provider policies remain exact', () => {
  assert.equal(providerCompatibility('claude', '2.1.267').compatible, true);
  assert.equal(providerCompatibility('claude', '2.1.268').compatible, false);
});