#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

import {
  capture,
  env,
  log,
  run,
  writeText,
} from '../lib/cli.mjs';
import {
  loadPublishConfig,
} from '../lib/apphub-publish-config.mjs';

const { options } = parseArgs(process.argv.slice(2));
const vault = options.vault ?? env('OP_VAULT', 'Tamber-Production');
const credentialsPath = options.output
  ?? env('GOOGLE_APPLICATION_CREDENTIALS')
  ?? `${env('RUNNER_TEMP', '/tmp')}/gcloud-service-account.json`;
const config = options.config ? loadPublishConfig(options.config) : undefined;

log(`Find Google Cloud service account in 1Password vault ${vault}`);
const credentials = findServiceAccountCredentials(vault);
writeText(credentialsPath, credentials);

log(`Authenticate gcloud as ${basename(credentialsPath)}`);
run('gcloud', [
  'auth',
  'activate-service-account',
  `--key-file=${credentialsPath}`,
]);
run('gcloud', ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)']);

if (config?.storageRoot) {
  log(`Verify gcloud can read ${config.storageRoot}`);
  run('gcloud', ['storage', 'ls', config.storageRoot]);
}

function findServiceAccountCredentials(vaultName) {
  const items = JSON.parse(capture('op', [
    'item',
    'list',
    '--vault',
    vaultName,
    '--format',
    'json',
  ]).stdout);

  const orderedItems = orderPreferred(items, (item) => item.title);
  for (const itemSummary of orderedItems) {
    const item = itemJson(vaultName, itemSummary.id);
    const fields = Array.isArray(item.fields) ? item.fields : [];
    const orderedFields = orderPreferred(fields, (field) => field.label);

    for (const field of orderedFields) {
      const credentials = parseCredentials(field.value);
      if (credentials) return credentials;
    }
  }

  throw new Error(`No Google Cloud service account JSON found in 1Password vault ${vaultName}`);
}

function itemJson(vaultName, itemId) {
  return JSON.parse(execFileSync('op', [
    'item',
    'get',
    itemId,
    '--vault',
    vaultName,
    '--format',
    'json',
    '--reveal',
  ], { encoding: 'utf8' }));
}

function orderPreferred(values, labelFor) {
  const preferred = values.filter((value) => isPreferred(labelFor(value)));
  return [
    ...preferred,
    ...values.filter((value) => !preferred.includes(value)),
  ];
}

function isPreferred(value) {
  const normalized = normalize(value);
  return normalized.includes('gcloud')
    || normalized.includes('googlecloud')
    || normalized.includes('gcp')
    || normalized.includes('serviceaccount')
    || normalized.includes('credentials');
}

function parseCredentials(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;

  for (const candidate of [
    raw,
    Buffer.from(raw, 'base64').toString('utf8'),
  ]) {
    try {
      const json = JSON.parse(candidate);
      if (json.type === 'service_account'
          && json.client_email
          && json.private_key) {
        return `${JSON.stringify(json, null, 2)}\n`;
      }
    } catch {
      // Keep trying candidate encodings.
    }
  }

  return undefined;
}

function normalize(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; ++i) {
    if (args[i] === '--config') {
      options.config = args[++i];
    } else if (args[i] === '--vault') {
      options.vault = args[++i];
    } else if (args[i] === '--output') {
      options.output = args[++i];
    } else {
      throw new Error(`Unknown argument: ${args[i]}`);
    }
  }
  return { options };
}
