import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// `namespace.js` imports `init.js` through the `init-barrel` package, which has no side effects, and
// reads `marker.initValue()` from the namespace. The import order walk reaches `init.js` through
// that read, at the position of the `init-barrel` import, so the chunk of `init.js` comes before the
// chunk of `common.js` in the imports of `c`. The chunk of `common.js` is the bitset host and the
// dominator of the runtime consumers, so it gets the runtime and `exec_order` 0, and `common.js`
// still reads the global after `init.js` sets it. `runtime_host_import_order_export_star` has a read
// that the walk does not reach.
// A fresh process, because `init.js` sets a global that `common.js` reads at load time.
const entry = JSON.stringify(new URL('./dist/c.js', import.meta.url).href);
const script = `const { c } = await import(${entry}); console.log(JSON.stringify(c.value));`;
const value = JSON.parse(
  execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }),
);
assert.equal(value, 'ready');
