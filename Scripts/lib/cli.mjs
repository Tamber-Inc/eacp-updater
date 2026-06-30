import { createHash } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const scriptsDir = dirname(dirname(fileURLToPath(import.meta.url)));
export const repoRoot = resolve(scriptsDir, '..');

export function log(message) {
  console.log(`\n==> ${message}`);
}

export function say(message, delaySeconds = 0) {
  console.log(`\n${message}`);
  if (delaySeconds > 0) {
    spawnSync(process.execPath, [
      '-e',
      `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${Math.round(delaySeconds * 1000)})`,
    ]);
  }
}

export function run(command, args = [], options = {}) {
  console.log(`+ ${[command, ...args].map(quoteArg).join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: options.stdio ?? 'inherit',
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status ?? 'signal ' + result.signal}`);
  }
  return result;
}

export function capture(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (result.status !== 0 && options.check !== false) {
    throw new Error(`${command} exited with ${result.status}: ${result.stderr}`);
  }
  return result;
}

export function start(command, args = [], options = {}) {
  console.log(`+ ${[command, ...args].map(quoteArg).join(' ')}`);
  return spawn(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: options.stdio ?? 'inherit',
  });
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

export function cleanDir(path) {
  rmSync(path, { recursive: true, force: true });
  ensureDir(path);
}

export function remove(path) {
  rmSync(path, { recursive: true, force: true });
}

export function fileExists(path) {
  return existsSync(path);
}

export function readText(path) {
  return readFileSync(path, 'utf8');
}

export function writeText(path, text) {
  ensureDir(dirname(path));
  writeFileSync(path, text);
}

export function writeJson(path, value) {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function sha256File(path) {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

export function requireMacOS(task) {
  if (process.platform !== 'darwin') {
    throw new Error(`${task} must run on macOS.`);
  }
}

export function env(name, fallback = undefined) {
  return process.env[name] ?? fallback;
}

export function requireEnv(names, help) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`${help}: missing ${missing.join(', ')}`);
  }
}

export function quoteArg(arg) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(arg)) {
    return arg;
  }
  return JSON.stringify(arg);
}
