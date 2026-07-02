import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { dim } from './ui.mjs';

// Windows: tools installed as .cmd/.bat launchers (gcloud, npx, ...) cannot
// be spawned directly — spawnSync reports ENOENT. Route those through
// cmd.exe with an explicitly quoted command line.
const windowsLauncherCache = new Map();

function resolveWindowsLauncher(command) {
  if (windowsLauncherCache.has(command)) return windowsLauncherCache.get(command);
  const where = spawnSync('where.exe', [command], { encoding: 'utf8' });
  const matches = where.status === 0
    ? where.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : [];
  const resolved = matches.find((match) => /\.(exe|com)$/i.test(match))
    ?? matches.find((match) => /\.(cmd|bat)$/i.test(match));
  windowsLauncherCache.set(command, resolved);
  return resolved;
}

function spawnSpec(command, args) {
  if (process.platform !== 'win32') return { command, args, extra: {} };
  const resolved = resolveWindowsLauncher(command);
  if (!resolved || !/\.(cmd|bat)$/i.test(resolved)) return { command, args, extra: {} };
  const commandLine = [resolved, ...args].map((part) => `"${part}"`).join(' ');
  return {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', `"${commandLine}"`],
    extra: { windowsVerbatimArguments: true },
  };
}

export function run(command, args = [], options = {}) {
  if (!options.quiet) console.log(dim(`  $ ${command} ${args.join(' ')}`));
  const spec = spawnSpec(command, args);
  const result = spawnSync(spec.command, spec.args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    stdio: options.quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    ...spec.extra,
  });
  if (result.status !== 0) {
    const detail = options.quiet ? `\n${result.stderr ?? ''}` : '';
    throw new Error(`${command} exited with ${result.status ?? `signal ${result.signal}`}${detail}`);
  }
  return result;
}

export function capture(command, args = [], options = {}) {
  const spec = spawnSpec(command, args);
  const result = spawnSync(spec.command, spec.args, {
    cwd: options.cwd ?? process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    ...spec.extra,
  });
  if (result.status !== 0 && options.check !== false) {
    throw new Error(`${command} exited with ${result.status}: ${result.stderr}`);
  }
  return result;
}

// Zip a directory so the archive unpacks to <directory-name>/... — ditto's
// --keepParent semantics. Windows uses the bsdtar shipped in System32 and
// leaves debug symbols out of the shipped artifact.
export function zipDirectory(sourceDir, zipPath) {
  mkdirSync(dirname(zipPath), { recursive: true });
  rmSync(zipPath, { force: true });
  if (process.platform === 'darwin') {
    run('ditto', ['-c', '-k', '--keepParent', sourceDir, zipPath], { quiet: true });
    return;
  }
  if (process.platform === 'win32') {
    const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    run(tar, ['-a', '-c', '--exclude', '*.pdb', '-f', zipPath,
      '-C', dirname(sourceDir), basename(sourceDir)], { quiet: true });
    return;
  }
  throw new Error(`zipDirectory is not implemented on ${process.platform}`);
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
