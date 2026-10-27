#!/usr/bin/env node
/**
 * One-shot setup for local development.
 *
 *   pnpm setup
 *
 * It installs deps, builds, runs tests, verifies packaging, and tries the
 * BiDi smoke probe. A failed smoke probe is not fatal; Firefox may simply be
 * closed.
 */

import { spawnSync } from 'node:child_process';

function run(command, args) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    console.error(`command failed: ${command} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}

function tryRun(command, args) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    console.log('skipped: command did not succeed');
  }
}

run('pnpm', ['install']);
run('pnpm', ['build']);
run('pnpm', ['test']);
run('pnpm', ['verify:release']);
run('pnpm', ['verify:package']);
tryRun('node', ['scripts/dev-smoke.mjs']);

console.log('\nsetup complete');
console.log('next: pnpm build && pnpm smoke');
