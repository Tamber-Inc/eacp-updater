#!/usr/bin/env node

import { env, repoRoot, run } from './lib/cli.mjs';

const { positionals, options } = parseArgs(process.argv.slice(2));
const [appNameArg, versionArg, channelArg] = positionals;

if (!appNameArg || !versionArg) {
  throw new Error('Usage: build-and-publish-app.mjs <appname> <version> [channel] --config <path>');
}

const appName = appNameArg.toLowerCase();
const version = versionArg;
const channel = channelArg ?? env('APPHUB_CHANNEL', env('CHANNEL', 'stable'));

const commonEnv = {
  ...process.env,
  VERSION: version,
  APPHUB_CHANNEL: channel,
  CHANNEL: channel,
};
if (options.config) {
  commonEnv.APPHUB_PUBLISH_CONFIG = options.config;
}

if (appName === 'apphub' || appName === 'hub') {
  run(process.execPath, ['Scripts/publish-remote-hub-version.mjs'], {
    cwd: repoRoot,
    env: commonEnv,
  });
} else if (
  appName === 'demo'
  || appName === 'realupdatedemo'
  || appName === 'real-update-demo'
) {
  run(process.execPath, ['Scripts/publish-remote-demo-app-version.mjs'], {
    cwd: repoRoot,
    env: commonEnv,
  });
} else {
  throw new Error(
    'Unknown app. Expected one of: apphub, demo',
  );
}

function parseArgs(args) {
  const positionals = [];
  const options = {};
  for (let i = 0; i < args.length; ++i) {
    if (args[i] === '--config') {
      options.config = args[++i];
      continue;
    }
    positionals.push(args[i]);
  }
  return { positionals, options };
}
