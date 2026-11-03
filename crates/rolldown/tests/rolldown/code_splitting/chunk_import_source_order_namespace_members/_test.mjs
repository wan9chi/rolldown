import assert from 'node:assert/strict';

// `z` reads `ui.B` before `ui.A`, but `ui/index.js` imports `a.js` first, so the chunk of `a.js`
// must come first in the imports of `z`.
await import('./dist/z.js');
assert.deepEqual(globalThis.log, ['a', 'b']);
