import assert from 'node:assert/strict';

// The import order walk does not follow the `export *` in `namespace.js`, so a chunk of
// `common.js` that hosted the runtime would run before the chunk of `init.js` in `c` (see "Runtime
// module placement" in internal-docs/code-splitting/implementation.md).
const { c } = await import('./dist/c.js');
assert.equal(c.value, 'ready');
