import test from 'node:test';
import assert from 'node:assert/strict';
import { DeliveryMcpServer } from '../node_modules/ai-delivery-workflow/dist/src/mcp/server.js';

const allowedOperations = [
  'status',
  'evidence_validate',
  'file_list',
  'file_search',
  'file_read',
  'git_status',
  'git_diff',
  'changed_paths',
  'scope_validate',
  'final_diff_validate',
  'command_run',
  'review_submit',
];

function serverFor(role) {
  const manifest = {
    stage: 'VALIDATING',
    filesystem: { read: ['**/*'], write: [], delete: [] },
    terminal: { available: true, fixedCommands: ['test'] },
    git: { inspect: true, mutate: false },
    mcp: { allowedServers: ['ai-delivery'], allowedOperations },
  };

  return new DeliveryMcpServer({
    current: async () => ({ role, manifest }),
  });
}

test('review sessions advertise read-only review operations without validation operations', async () => {
  const names = (await serverFor('review').tools()).map(({ name }) => name);

  assert.ok(names.includes('file_read'));
  assert.ok(names.includes('git_diff'));
  assert.ok(names.includes('evidence_validate'));
  assert.ok(names.includes('review_submit'));
  assert.ok(!names.includes('scope_validate'));
  assert.ok(!names.includes('final_diff_validate'));
  assert.ok(!names.includes('command_run'));
});

test('validation sessions retain validation and fixed-command operations', async () => {
  const names = (await serverFor('validation').tools()).map(({ name }) => name);

  assert.ok(names.includes('scope_validate'));
  assert.ok(names.includes('final_diff_validate'));
  assert.ok(names.includes('command_run'));
  assert.ok(!names.includes('review_submit'));
});
