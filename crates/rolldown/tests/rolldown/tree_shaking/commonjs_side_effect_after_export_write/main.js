import assert from 'node:assert';
import './in_if.cjs';

assert.strictEqual(globalThis.effectInIf, true);
