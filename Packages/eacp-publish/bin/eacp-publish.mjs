#!/usr/bin/env node

import { bold, dim, fail } from '../lib/ui.mjs';

const USAGE = `
${bold('eacp-publish')} — build, sign, and publish an eacp-updater app suite

  ${bold('eacp-publish init')}
      Scaffold an eacp-publish.json in the current directory.

  ${bold('eacp-publish release <version>')} [--channel <name>] [--no-notarize]
                                 [--dry-run] [--build-dir <dir>]
                                 [--cmake-arg <arg>]...
      Build Release, sign + notarize, package, and upload artifacts plus
      channel metadata. Metadata is emitted and validated by the
      eacp-updater-tool binary built from the updater library itself, so
      what you publish is guaranteed parseable by what you shipped.

  ${bold('eacp-publish status')}
      Show every live channel and product version at the configured host.

  ${bold('eacp-publish verify')} [--channel <name>]
      Download everything a fresh install would download and check it.

${dim('Signing credentials come from the environment; the intended pattern is')}
${dim('  op run --env-file=.github/op/<your>-signing.env -- eacp-publish release 1.2.3')}
`;

function parseArgs(argv) {
  const positionals = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const flagOnly = ['no-notarize', 'dry-run'].includes(key);
    const value = flagOnly ? true : argv[++index];
    if (value === undefined) fail(`--${key} needs a value`);
    if (key in options) options[key] = [].concat(options[key], value);
    else options[key] = value;
  }
  return { positionals, options };
}

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

try {
  if (command === 'init') {
    await (await import('../lib/commands/init.mjs')).init(args);
  } else if (command === 'release') {
    await (await import('../lib/commands/release.mjs')).release(args);
  } else if (command === 'status') {
    await (await import('../lib/commands/status.mjs')).status(args);
  } else if (command === 'verify') {
    await (await import('../lib/commands/verify.mjs')).verify(args);
  } else {
    console.log(USAGE);
    process.exit(command === 'help' || command === undefined ? 0 : 1);
  }
} catch (error) {
  fail(error.message ?? String(error));
}
