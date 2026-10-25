// Replay check: compare the outputs of the cached docs tasks with a fresh build.
//
//   node .github/replay/outputs.mjs snapshot <file> [<copy dir>]   hash build outputs into <file>,
//                                                                    and copy them into <copy dir>
//   node .github/replay/outputs.mjs compare <cached> <fresh> [<copy dir>]   with a copy dir, also print
//                                       where each differing file's two versions differ
//   node .github/replay/outputs.mjs collect <cached> <fresh> <copy dir> <out dir>
//                                       copy both versions of each differing output into <out dir>
//
// Outputs are the files git doesn't track (ignored ones included) and tracked files the build
// modified, outside node_modules and .git. `compare` prints one `replay-verify:` line per path
// that differs, exists only after the cached build, or exists only after the fresh one.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [command, ...args] = process.argv.slice(2);

function list(flags) {
  const out = execFileSync('git', ['ls-files', '-z', ...flags], { maxBuffer: 1 << 30 });
  return out.toString('utf8').split('\0').filter(Boolean);
}

if (command === 'snapshot') {
  const modified = list(['--modified']);
  for (const path of modified) console.log(`replay-verify: modified ${path}`);
  const paths = new Set([
    ...list(['--others', '--exclude=node_modules', '--exclude=.git']),
    ...modified,
  ]);
  const hashes = {};
  for (const path of [...paths].sort(byCodeUnit)) {
    try {
      hashes[path] = createHash('sha256').update(readFileSync(path)).digest('hex');
    } catch (error) {
      hashes[path] = `unreadable:${error.code}`;
    }
  }
  writeFileSync(args[0], JSON.stringify(hashes));
  if (args[1]) for (const path of Object.keys(hashes)) copy(path, join(args[1], path));
  console.log(`replay-verify: snapshot of ${Object.keys(hashes).length} files`);
} else if (command === 'compare') {
  const cached = JSON.parse(readFileSync(args[0], 'utf8'));
  const fresh = JSON.parse(readFileSync(args[1], 'utf8'));
  const counts = { differs: 0, 'only-cached': 0, 'only-fresh': 0 };
  for (const path of [...new Set([...Object.keys(cached), ...Object.keys(fresh)])].sort(
    byCodeUnit,
  )) {
    const kind = !(path in fresh)
      ? 'only-cached'
      : !(path in cached)
        ? 'only-fresh'
        : cached[path] !== fresh[path]
          ? 'differs'
          : null;
    if (!kind) continue;
    counts[kind]++;
    console.log(`replay-verify: ${kind} ${path}`);
    if (kind === 'differs' && args[2]) delta(join(args[2], path), path);
  }
  console.log(
    `replay-verify: done ${counts.differs} differ, ${counts['only-cached']} only cached, ${counts['only-fresh']} only fresh, ${Object.keys(fresh).length} files`,
  );
} else if (command === 'collect') {
  const cached = JSON.parse(readFileSync(args[0], 'utf8'));
  const fresh = JSON.parse(readFileSync(args[1], 'utf8'));
  let n = 0;
  for (const path of new Set([...Object.keys(cached), ...Object.keys(fresh)])) {
    if (cached[path] === fresh[path]) continue;
    if (path in cached) copy(join(args[2], path), join(args[3], 'cached', path));
    if (path in fresh) copy(path, join(args[3], 'fresh', path));
    n++;
  }
  console.log(`replay-verify: collected ${n} differing outputs`);
} else {
  console.error(
    'Usage: outputs.mjs snapshot <file> [<copy dir>] | compare <cached> <fresh> | collect <cached> <fresh> <copy dir> <out dir>',
  );
  process.exit(2);
}

function byCodeUnit(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function copy(from, to) {
  if (!existsSync(from)) return;
  mkdirSync(dirname(to), { recursive: true });
  try {
    copyFileSync(from, to);
  } catch {
    // Folders listed by git as untracked entries, unreadable files: nothing to copy.
  }
}

// Print the differing middle of two versions of a file, trimmed to the common prefix and suffix.
function delta(cachedPath, freshPath) {
  try {
    const a = readFileSync(cachedPath);
    const b = readFileSync(freshPath);
    if (a.length > 16 << 20 || b.length > 16 << 20) return;
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let end = 0;
    while (
      end < a.length - start &&
      end < b.length - start &&
      a[a.length - 1 - end] === b[b.length - 1 - end]
    )
      end++;
    const show = (buf) =>
      JSON.stringify(
        buf
          .subarray(start, buf.length - end)
          .toString('utf8')
          .slice(0, 200),
      );
    console.log(`replay-verify: delta ${freshPath} at ${start}: ${show(a)} -> ${show(b)}`);
  } catch {
    // Missing or unreadable copies: no delta.
  }
}
