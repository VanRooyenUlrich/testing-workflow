import assert from 'node:assert/strict';
import test from 'node:test';

import { greet } from '../src/index.js';

test('greet returns a personalized message', () => {
  assert.equal(greet('Workflow'), 'Hello, Workflow!');
});

test('greet rejects an empty name', () => {
  assert.throws(() => greet('  '), /A name is required/);
});
