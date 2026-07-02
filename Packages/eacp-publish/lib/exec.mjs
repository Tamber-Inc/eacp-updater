import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { dim } from './ui.mjs';

export function run(command, args = [], options = {}) {
  if (!options.quiet) console.log(dim(`  $ ${command} ${args.join(' ')}`));
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    stdio: options.quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const detail = options.quiet ? `\n${result.stderr ?? ''}` : '';
    throw new Error(`${command} exited with ${result.status ?? `signal ${result.signal}`}${detail}`);
  }
  return result;
}

export function capture(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (result.status !== 0 && options.check !== false) {
    throw new Error(`${command} exited with ${result.status}: ${result.stderr}`);
  }
  return result;
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function writeText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export function writeJson(path, value) {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function cleanDir(path) {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}
