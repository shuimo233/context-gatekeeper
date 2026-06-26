#!/usr/bin/env node
/**
 * context-gatekeeper-cli wrapper.
 *
 * This file is the `bin` entry point for the npm package. When a
 * compiled `dist/cli/cli.js` exists it runs that directly. Otherwise it
 * falls back to running the TypeScript source via `tsx` (which the
 * package depends on via devDependencies, and end users invoke via
 * `npx -y`).
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, '..');

const CANDIDATES = [
  // Preferred: compiled JS published by `npm run build:publish`.
  join(pkgRoot, 'dist', 'src', 'cli', 'cli.js'),
  // Fallback: source TS shipped alongside dist/ (publish copies it via prepack).
  join(pkgRoot, 'dist', 'scripts', 'cli.ts'),
  // Last resort: source TS in the working tree (dev mode, no build).
  join(pkgRoot, 'scripts', 'cli.ts'),
];

function spawnChild(command, args) {
  const opts = {
    stdio: 'inherit',
    env: process.env,
  };
  if (process.platform === 'win32') opts.shell = true;
  return spawn(command, args, opts);
}

function main() {
  const args = process.argv.slice(2);
  const compiled = CANDIDATES.find((p) => existsSync(p));
  if (compiled) {
    if (compiled.endsWith('.ts')) {
      // Source fallback: invoke tsx via npx so end users do not need to
      // install tsx globally; npx -y fetches it on demand.
      const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      const child = spawnChild(npxCmd, ['-y', 'tsx', compiled, ...args]);
      child.on('exit', (code) => process.exit(code ?? 0));
      return;
    }
    const child = spawnChild(process.execPath, [compiled, ...args]);
    child.on('exit', (code) => process.exit(code ?? 0));
    return;
  }
  console.error('context-gatekeeper-cli: cannot locate CLI entry point. Looked in:');
  for (const p of CANDIDATES) console.error('  -', p);
  console.error('Run `npm run build` to produce dist/.');
  process.exit(1);
}

main();