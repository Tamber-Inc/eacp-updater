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
  || appName === 'realupdatedemo'
  || appName === 'real-update-demo'
) {
  run(process.execPath, ['Scripts/publish-remote-demo-app-version.mjs'], {
    cwd: repoRoot,
    env: commonEnv,
  });
} else {
  const product = catalogApp(appName);
  run(process.execPath, ['Scripts/publish-generated-catalog-app-version.mjs'], {
    cwd: repoRoot,
    env: {
      ...commonEnv,
      APPHUB_CATALOG_PRODUCT_ID: product.productId,
      APPHUB_CATALOG_TARGET: product.target,
    },
  });
}

function catalogApp(name) {
  if (name === 'maze' || name === 'com.eacp.maze') {
    return { productId: 'com.eacp.maze', target: 'Maze' };
  }
  if (name === 'teapot' || name === 'com.eacp.teapot') {
    return { productId: 'com.eacp.teapot', target: 'Teapot' };
  }
  if (name === 'jsonview1' || name === 'com.eacp.jsonview1') {
    return { productId: 'com.eacp.jsonview1', target: 'JsonView1' };
  }
  if (name === 'jsonview2' || name === 'com.eacp.jsonview2') {
    return { productId: 'com.eacp.jsonview2', target: 'JsonView2' };
  }

  throw new Error(
    'Unknown app. Expected one of: apphub, demo, maze, teapot, jsonview1, jsonview2',
  );
}
