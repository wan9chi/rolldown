import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// A fresh process, so another entry cannot run `setup.js` or `owner.js` first.
const entry = JSON.stringify(new URL('./dist/namespace.js', import.meta.url).href);
const script = `const { order } = await import(${entry}); console.log(JSON.stringify(order));`;
const order = JSON.parse(
  execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }),
);
assert.deepEqual(order, ['setup', 'owner']);
