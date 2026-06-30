import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { readText, repoRoot, run } from './cli.mjs';

export function readGeneratedCatalog(buildDir) {
  return JSON.parse(readText(generatedCatalogPath(buildDir)));
}

export function generatedCatalogPath(buildDir) {
  return join(
    buildDir,
    'Demos',
    'AppHub',
    'generated-catalog',
    'apphub-catalog.json',
  );
}

export function generatedCatalogArtifactsDir(buildDir) {
  return join(
    buildDir,
    'Demos',
    'AppHub',
    'generated-catalog',
    'artifacts',
  );
}

export function findCatalogAppBundle(buildDir, product) {
  const expected = product.bundleName;
  const roots = [
    join(buildDir, 'Demos'),
  ];

  for (const root of roots) {
    const found = findBundle(root, expected);
    if (found) return found;
  }

  throw new Error(`Could not find built bundle ${expected} for ${product.id}`);
}

export function catalogProductDescriptor({ buildDir, product }) {
  return [
    product.id,
    product.id,
    product.name,
    product.bundleName,
    product.latestVersion,
    product.kind,
    (product.dependencies ?? []).join(','),
    findCatalogAppBundle(buildDir, product),
  ].join('|');
}

export function generateCatalogFromProducts({
  buildDir,
  products,
  outDir,
  catalogPath,
  catalogVersion,
  channel,
  releaseBaseUrl,
}) {
  const productArgs = [];
  for (const product of products) {
    productArgs.push('--product', catalogProductDescriptor({ buildDir, product }));
  }

  run(process.execPath, [
    join(repoRoot, 'Scripts', 'generate-apphub-local-catalog.mjs'),
    '--catalog',
    catalogPath,
    '--artifact-dir',
    outDir,
    '--catalog-version',
    String(catalogVersion),
    '--channel',
    channel,
    '--url-base',
    releaseBaseUrl,
    ...productArgs,
  ]);
}

function findBundle(root, bundleName) {
  if (!existsSync(root)) return null;

  return walk(root, bundleName)
    .sort((left, right) => scorePath(left) - scorePath(right))[0] ?? null;
}

function walk(root, bundleName, depth = 0) {
  if (depth > 8) return [];

  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const path = join(root, entry.name);
    if (entry.name === bundleName && statSync(path).isDirectory()) {
      out.push(path);
      continue;
    }
    out.push(...walk(path, bundleName, depth + 1));
  }
  return out;
}

function scorePath(path) {
  const name = basename(path);
  return path.endsWith(`/${name}`) ? path.length : Number.MAX_SAFE_INTEGER;
}
