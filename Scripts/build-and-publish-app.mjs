#!/usr/bin/env node

import { env, repoRoot, run } from './lib/cli.mjs';

const [appNameArg, versionArg, channelArg] = process.argv.slice(2);

if (!appNameArg || !versionArg) {
  throw new Error('Usage: build-and-publish-app.mjs <appname> <version> [channel]');
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

if (appName === 'apphub' || appName === 'hub') {
  run(process.execPath, ['Scripts/publish-remote-hub-version.mjs'], {
    cwd: repoRoot,
    env: commonEnv,
  });
} else if (
  appName === 'demo'
  || appName === 'helloworlddemo'
  || appName === 'hello-world-demo'
  || appName === 'realupdatedemo'
  || appName === 'real-update-demo'
) {
  run(process.execPath, ['Scripts/publish-remote-demo-app-version.mjs'], {
    cwd: repoRoot,
    env: commonEnv,
  });
} else {
  throw new Error(
    'Unknown app. Expected one of: apphub, demo, hello-world-demo',
  );
}
