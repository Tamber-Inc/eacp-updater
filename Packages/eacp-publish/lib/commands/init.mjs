import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { writeJson } from '../exec.mjs';
import { banner, fail, info, ok } from '../ui.mjs';

export async function init() {
  const path = join(process.cwd(), 'eacp-publish.json');
  if (existsSync(path)) fail('eacp-publish.json already exists here');

  writeJson(path, {
    hosting: {
      storageRoot: 'gs://your-bucket/your-suite',
      publicRoot: 'https://storage.googleapis.com/your-bucket/your-suite',
    },
    channels: { default: 'stable' },
    signing: { macos: { notarize: true } },
    build: { macOSDeploymentTarget: '11.0' },
    hub: { productId: 'com.example.Hub', target: 'MyHub' },
    products: {
      'com.example.MyApp': { target: 'MyApp' },
    },
  });

  ok('wrote eacp-publish.json');
  info('1. declare each app with eacp_updater_add_app() in CMake');
  info('2. fill in hosting + product ids/targets above');
  info('3. release with: op run --env-file=<signing env> -- eacp-publish release 1.0.0');
  banner('Ready to publish');
}
