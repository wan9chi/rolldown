// Measured startup CPU on the module graph (lib/worker/startup-cpu.mjs) and the paired
// keep rule (lib/worker/measure.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { deferAllInto, evalOverrides } from '../lib/module-graph.mjs';
import { needsMorePairs, pairedCall, pairedVerdict, signTail } from '../lib/worker/measure.mjs';
import {
  classModules,
  cpuByModule,
  cpuByOutputFile,
  cpuOf,
  isVirtual,
  lazyInStartupChunks,
  libraryShare,
  startupGroups,
  wrapperPrice,
} from '../lib/worker/startup-cpu.mjs';
import { indexOf, makeGraph } from './graph-fixtures.mjs';

// virtual entry -> worker.ts; the request path and a cron job share seed.ts; a Workflow
// class holds an AI SDK; zod is a library every part imports.
const graph = makeGraph(
  [
    { id: '\\0virtual:entry', bytes: 0, imports: [[1, false]] },
    {
      id: 'src/worker.ts',
      bytes: 1,
      imports: [
        [2, false],
        [3, false],
        [4, false],
        [6, false],
      ],
    },
    {
      id: 'src/app.ts',
      bytes: 10,
      imports: [
        [5, false],
        [6, false],
      ],
    },
    {
      id: 'src/cron.ts',
      bytes: 10,
      imports: [
        [5, false],
        [7, false],
      ],
    },
    { id: 'src/flows/image.ts', bytes: 10, imports: [[8, false]] },
    { id: 'src/seed.ts', bytes: 100, imports: [] },
    { id: 'zod/index.js', bytes: 50, imports: [] },
    { id: 'src/cron-jobs.ts', bytes: 10, imports: [] },
    { id: 'ai/index.js', bytes: 200, imports: [] },
  ],
  ['\\0virtual:entry'],
);
const bySource = {
  '../src/app.ts': 1,
  '../src/cron.ts': 0.5,
  '../src/seed.ts': 6,
  '../src/flows/image.ts': 0.2,
  '../node_modules/.bun/ai@6/node_modules/ai/index.js': 9,
  '../node_modules/zod/index.js': 2,
  '../src/cron-jobs.ts': 1,
  '../src/gone.ts': 0.7,
};
const isApp = (id) => isVirtual(id) || id.startsWith('src/');

test('profile sources map onto graph ids, package stores included', () => {
  const cpu = cpuByModule(graph, bySource);
  assert.equal(cpu.byIdx.get(indexOf(graph, 'ai/index.js')), 9);
  assert.equal(cpu.byIdx.get(indexOf(graph, 'zod/index.js')), 2);
  assert.equal(cpu.byIdx.get(indexOf(graph, 'src/seed.ts')), 6);
  assert.equal(cpu.unmatchedMs, 0.7);
});

test('startup CPU by import: the rows are the dominator children under the app entry', () => {
  const groups = startupGroups(graph, cpuByModule(graph, bySource), { isApp });
  assert.deepEqual(groups.chain, ['\\0virtual:entry', 'src/worker.ts']);
  assert.equal(groups.anchor.ms, 19.7);
  assert.deepEqual(
    groups.rows.map((r) => [r.id, r.ms, r.modules, r.importers]),
    [
      ['src/flows/image.ts', 9.2, 2, 1],
      ['src/seed.ts', 6, 1, 2],
      ['zod/index.js', 2, 1, 2],
      ['src/cron.ts', 1.5, 2, 1],
      ['src/app.ts', 1, 1, 1],
    ],
  );
  assert.deepEqual(
    groups.rows[0].children.map((c) => [c.id, c.ms]),
    [['ai/index.js', 9]],
  );
});

test('a module holding most of the time stays a row; the descent never enters a library', () => {
  const hot = { ...bySource, '../src/seed.ts': 500 };
  const groups = startupGroups(graph, cpuByModule(graph, hot), { isApp });
  assert.equal(groups.anchor.id, 'src/worker.ts');
  assert.equal(groups.rows[0].id, 'src/seed.ts');
  const lib = makeGraph(
    [
      { id: '\\0virtual:entry', bytes: 0, imports: [[1, false]] },
      { id: 'src/worker.ts', bytes: 1, imports: [[2, false]] },
      { id: 'zod/index.js', bytes: 1, imports: [[3, false]] },
      { id: 'zod/core.js', bytes: 1, imports: [] },
    ],
    ['\\0virtual:entry'],
  );
  const g = startupGroups(lib, cpuByModule(lib, { '../node_modules/zod/core.js': 5 }), { isApp });
  assert.equal(g.anchor.id, 'src/worker.ts');
  assert.deepEqual(
    g.rows.map((r) => r.id),
    ['zod/index.js'],
  );
});

test('a module that two parts share moves only with both: the group prices what one cannot', () => {
  const cpu = cpuByModule(graph, bySource);
  const price = (ids) => {
    const removed = evalOverrides(
      graph,
      ids.flatMap((id) => deferAllInto(graph, indexOf(graph, id))),
    ).removed;
    return cpuOf(graph, cpu, removed);
  };
  assert.equal(price(['src/app.ts']), 1);
  assert.equal(price(['src/cron.ts']), 1.5);
  assert.equal(price(['src/app.ts', 'src/cron.ts']), 8.5);
});

test('class modules are found by their declaration, and wrappers price the closures together', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-kit-classes-'));
  try {
    fs.mkdirSync(path.join(root, 'src/flows'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'src/flows/image.ts'),
      'export class ImageWorkflow extends WorkflowEntrypoint {}\n',
    );
    fs.writeFileSync(path.join(root, 'src/app.ts'), '// ImageWorkflowX is not a class here\n');
    const found = classModules(graph, ['ImageWorkflow', 'MissingRoom'], root);
    assert.deepEqual(
      found.map((c) => [c.name, c.id]),
      [['ImageWorkflow', 'src/flows/image.ts']],
    );
    const price = wrapperPrice(graph, cpuByModule(graph, bySource), found);
    assert.equal(price.ms, 9.2);
    assert.equal(price.removedCount, 2);
    assert.deepEqual(
      price.perClass.map((c) => [c.name, c.ms]),
      [['ImageWorkflow', 9.2]],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('paired keep rule: the floor, or every pair on one side', () => {
  const call = (pairs, deltaMs) =>
    pairedCall(pairedVerdict({ pairs, deltaMs, appStartupMs: 30 }), pairs.length);
  assert.equal(call([-9.6, -9.4, -9.7, -10.3, -9.8], -9.7), 'IMPROVEMENT beyond noise');
  // tss run 3: real, under the floor, lower in every pair
  assert.equal(
    call([-1.7, -0.7, -1.2, -1.3, -1], -1.2),
    'IMPROVEMENT beyond noise - small: lower in all 5 pairs (under the 3ms floor)',
  );
  assert.equal(
    call([0.8, 1.2, 0.6, 1.1, 0.9], 0.9),
    'REGRESSION beyond noise - small: higher in all 5 pairs (under the 3ms floor)',
  );
  // lexema run 4, round 3: both sides
  assert.equal(
    call([-1.5, 3.9, 0.1, -1.6, -2], -1.5),
    'within noise (floor 3ms) - no effect proven',
  );
  // one-sided, but too few pairs or too small a median
  assert.equal(call([-1, -1, -1, -1], -1), 'within noise (floor 3ms) - no effect proven');
  assert.equal(
    call([-0.3, -0.2, -0.4, -0.1, -0.3], -0.3),
    'within noise (floor 3ms) - no effect proven',
  );
});

test('sign test: a no-op puts 5 of 5 or 8 of 9 pairs on one side by chance at most 1 in 32', () => {
  assert.equal(signTail(5, 5), 1 / 32);
  assert.equal(signTail(4, 5), 6 / 32);
  assert.equal(signTail(8, 9), 10 / 512);
  assert.equal(signTail(7, 9), 46 / 512);
  const call = (pairs) => {
    const sorted = [...pairs].sort((a, b) => a - b);
    const deltaMs = sorted[(sorted.length - 1) / 2];
    return pairedCall(pairedVerdict({ pairs, deltaMs, appStartupMs: 30 }), pairs.length);
  };
  assert.equal(
    call([-1.2, -0.8, 0.4, -1.5, -1, -0.9, -1.3, -0.6, -1.1]),
    'IMPROVEMENT beyond noise - small: lower in 8 of 9 pairs (under the 3ms floor)',
  );
  assert.equal(
    call([-1.2, -0.8, 0.4, -1.5, -1, 0.9, -1.3, -0.6, -1.1]),
    'within noise (floor 3ms) - no effect proven',
  );
});

test('a series that leans one way without deciding gets more pairs', () => {
  const more = (pairs, deltaMs) => needsMorePairs({ pairs, deltaMs, appStartupMs: 30 });
  // backlex run 5, round 1: the OpenAPI deferral that later measured -16ms
  assert.equal(more([-4.9, -0.3, -7.3, -1.6, 0.9], -1.6), true);
  assert.equal(more([-1.7, -0.7, -1.2, -1.3, -1], -1.2), false); // already decided
  assert.equal(more([-1.5, 3.9, 0.1, -1.6, -2], -1.5), false); // both sides
  assert.equal(more([-0.3, -0.2, 0.4, -0.1, -0.3], -0.2), false); // too small
  assert.equal(more([-1, -1, 1, -1, -1, -1, -1, -1, -1], -1), false); // already 9 pairs
});

test('attribution output files map onto graph ids; library self time is reported apart', () => {
  const evaluating = cpuByOutputFile(graph, {
    'src/app.js': 3,
    'src/flows/image.js': 4,
    'node_modules/.bun/zod@4/node_modules/zod/index.js': 2,
    'src/gone.js': 1,
  });
  assert.equal(evaluating.byIdx.get(indexOf(graph, 'src/app.ts')), 3);
  assert.equal(evaluating.byIdx.get(indexOf(graph, 'src/flows/image.ts')), 4);
  assert.equal(evaluating.byIdx.get(indexOf(graph, 'zod/index.js')), 2);
  assert.equal(evaluating.unmatchedMs, 1);
  const lib = libraryShare(graph, cpuByModule(graph, bySource), isApp);
  assert.equal(lib.ms, 11);
  assert.equal(lib.totalMs, 19.7);
  assert.deepEqual(lib.top, [
    ['ai', 9],
    ['zod', 2],
  ]);
});

test('a startup chunk that holds modules only dynamic imports reach is found', () => {
  const g = makeGraph(
    [
      { id: '\\0virtual:entry', bytes: 0, imports: [[1, false]] },
      {
        id: 'src/worker.ts',
        bytes: 1,
        imports: [
          [2, false],
          [3, true],
        ],
      },
      { id: 'hono/index.js', bytes: 10, imports: [] },
      { id: 'src/ai.ts', bytes: 1, imports: [[4, false]] },
      { id: '@ai-sdk/openai/index.js', bytes: 200, imports: [] },
    ],
    ['\\0virtual:entry'],
  );
  const lazy = lazyInStartupChunks(g, [
    { source: '../src/worker.ts', script: 'index.js', totalBytes: 1000 },
    { source: '../node_modules/hono/index.js', script: 'assets/vendor.js', totalBytes: 10000 },
    {
      source: '../node_modules/.bun/@ai-sdk+openai@3/node_modules/@ai-sdk/openai/index.js',
      script: 'assets/vendor.js',
      totalBytes: 200000,
    },
  ]);
  assert.equal(lazy.count, 1);
  assert.equal(lazy.bytes, 200000);
  assert.deepEqual(lazy.byScript, [['assets/vendor.js', 200000]]);
  assert.deepEqual(lazy.byPackage, [['@ai-sdk/openai', 200000]]);
});
