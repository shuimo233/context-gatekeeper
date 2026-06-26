/**
 * Copy the CLI source tree (scripts/cli.ts, scripts/cli/, scripts/agents/)
 * into dist/scripts/ so the published package contains the entry points
 * bin/context-gatekeeper-cli.js looks for.
 *
 * Why this exists: tsc compiles only src/** per tsconfig.json. The CLI
 * lives under scripts/ and is run via tsx at runtime - there is no need
 * to compile it to JS, but we DO need to ship the .ts files inside the
 * npm tarball. package.json#files whitelists dist, so we copy scripts/
 * into dist/scripts/.
 *
 * This runs as part of npm run build (and therefore npm pack via prepack).
 */
import { cpSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, '..');
const SRC = join(pkgRoot, 'scripts');
const DST = join(pkgRoot, 'dist', 'scripts');

if (!existsSync(SRC)) {
  console.error(`copy-for-publish: source not found: ${SRC}`);
  process.exit(1);
}

mkdirSync(DST, { recursive: true });
cpSync(SRC, DST, { recursive: true, dereference: true });

// Drop dev-only subtrees that should not ship to end users. These contain
// test harnesses and reporters that import vitest; shipping them would
// require vitest in dependencies.
const dropDirs = ['tests', 'reporters', 'reports'];
for (const d of dropDirs) {
  rmSync(join(DST, d), { recursive: true, force: true });
}

// Drop top-level dev-only files at scripts/ root.
const dropFiles = ['cross-agent-test.ts', 'mcp-client.ts', 'copy-for-publish.mjs'];
for (const f of dropFiles) {
  rmSync(join(DST, f), { force: true });
}

console.log(`copy-for-publish: copied ${SRC} -> ${DST}`);
