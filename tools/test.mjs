#!/usr/bin/env node
/**
 * Portable test runner.
 *
 * `node --test "tests/*.test.mjs"` works on Node 21+, but Node 20 does not
 * expand globs, and older patch releases disagree about directory arguments.
 * RivalMode supports Node 20+, so resolve the files ourselves.
 *
 *   node tools/test.mjs            # run everything
 *   UPDATE_GOLDEN=1 node tools/test.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.join(import.meta.dirname, '..', 'tests');
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort()
  .map((f) => path.join('tests', f));

if (!files.length) {
  console.error('no tests found in tests/');
  process.exit(1);
}

const child = spawn(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
