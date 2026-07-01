import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { env, readText, repoRoot } from './cli.mjs';

export function loadPublishConfig(configPath) {
  const requestedPath = configPath ?? env('APPHUB_PUBLISH_CONFIG', env('EACP_PUBLISH_CONFIG'));
  if (!requestedPath) {
    throw new Error(
      'Publish config is required. Pass --config <path> or set APPHUB_PUBLISH_CONFIG.',
    );
  }

  const resolvedPath = resolve(repoRoot, requestedPath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`Publish config does not exist: ${resolvedPath}`);
  }

  const config = JSON.parse(readText(resolvedPath));
  config.storageRoot = stripTrailingSlash(requiredString(config, 'storageRoot'));
  config.publicRoot = stripTrailingSlash(requiredString(config, 'publicRoot'));
  config.defaultChannel = normalizeChannel(requiredString(config, 'defaultChannel'));

  if (config.release) {
    if (config.release.baseUrl)
      config.release.baseUrl = stripTrailingSlash(config.release.baseUrl);
    if (!config.release.baseUrl && config.release.repo && config.release.tag) {
      config.release.baseUrl = `https://github.com/${config.release.repo}/releases/download/${config.release.tag}`;
    }
  }

  return config;
}

export function requireHubConfig(config) {
  const hub = requiredObject(config, 'hub');
  requiredString(hub, 'productId', 'hub.productId');
  requiredString(hub, 'name', 'hub.name');
  requiredString(hub, 'bundleName', 'hub.bundleName');
  requiredString(hub, 'packageNameTemplate', 'hub.packageNameTemplate');
  hub.installerManifestName = hub.installerManifestName || 'hub-installer.json';
  return hub;
}

export function configuredRelease(config) {
  const release = requiredObject(config, 'release');
  const configuredTag = requiredString(release, 'tag', 'release.tag');
  const configuredRepo = requiredString(release, 'repo', 'release.repo');
  const tag = envString('RELEASE_TAG', configuredTag);
  const repo = envString('RELEASE_REPO', configuredRepo);
  const baseUrl = envString(
    'RELEASE_BASE_URL',
    tag === configuredTag && repo === configuredRepo && release.baseUrl
      ? stripTrailingSlash(release.baseUrl)
      : `https://github.com/${repo}/releases/download/${tag}`,
  );
  return { tag, repo, baseUrl };
}

export function configuredChannel(config, explicit) {
  return normalizeChannel(
    explicit ?? env('APPHUB_CHANNEL', env('CHANNEL', config.defaultChannel)),
  );
}

export function configuredVersion(explicit) {
  const version = explicit ?? env('VERSION');
  if (!version) {
    throw new Error('Version is required. Pass <version> or set VERSION.');
  }
  return version;
}

export function configuredProduct(config, productId, artifactPath) {
  const envProductId = env('APPHUB_PRODUCT_ID', '').trim();
  const id = productId || envProductId;
  if (!id) {
    throw new Error(
      'Product id is required. Pass --product <id> or set APPHUB_PRODUCT_ID.',
    );
  }

  const product = config.products?.[id] ?? {};
  return {
    id,
    name: env('APPHUB_PRODUCT_NAME', product.name ?? id),
    kind: env('APPHUB_PRODUCT_KIND', product.kind ?? inferKind(artifactPath)),
    bundleName: env('APPHUB_BUNDLE_NAME', product.bundleName ?? ''),
    dependencies: product.dependencies ?? [],
  };
}

export function channelCatalogObject(channel) {
  return `channels/${safeChannelPath(channel)}/apphub-catalog.json`;
}

export function channelInstallerManifestObject(config, channel) {
  const hub = requireHubConfig(config);
  return `channels/${safeChannelPath(channel)}/${hub.installerManifestName}`;
}

export function channelArtifactObject(channel, fileName) {
  return `channels/${safeChannelPath(channel)}/artifacts/${fileName}`;
}

export function catalogUrl(config, channel) {
  return `${config.publicRoot}/${channelCatalogObject(channel)}`;
}

export function objectPublicUrl(config, object) {
  return `${config.publicRoot}/${object}`;
}

export function objectStorageUrl(config, object) {
  return `${config.storageRoot}/${object}`;
}

export function upsertChannel(index, config, channel) {
  const channels = (index.channels ?? []).filter((entry) => entry.id !== channel);
  channels.push({
    id: channel,
    name: titleForChannel(channel),
    catalogUrl: catalogUrl(config, channel),
    isDefault: (index.defaultChannel || config.defaultChannel || channel) === channel,
  });
  index.defaultChannel = index.defaultChannel || config.defaultChannel || channel;
  index.channels = channels.sort((left, right) => left.id.localeCompare(right.id));
  return index;
}

export function emptyChannelIndex(config, channel) {
  return {
    defaultChannel: config.defaultChannel || channel,
    channels: [],
  };
}

export function normalizeChannel(channel) {
  const trimmed = String(channel ?? '').trim();
  return trimmed || 'stable';
}

export function safeChannelPath(channel) {
  return normalizeChannel(channel)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'stable';
}

export function stripTrailingSlash(value) {
  return String(value ?? '').replace(/\/+$/, '');
}

export function titleForChannel(channel) {
  return channel
    .split(/[/-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || channel;
}

export function templateName(template, values) {
  return requiredString({ template }, 'template')
    .replace(/\{([A-Za-z0-9_]+)\}/g, (_, key) => values[key] ?? '');
}

function requiredObject(parent, key, label = key) {
  const value = parent?.[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Publish config requires object: ${label}`);
  }
  return value;
}

function requiredString(parent, key, label = key) {
  const value = parent?.[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Publish config requires string: ${label}`);
  }
  return value.trim();
}

function envString(name, fallback) {
  const value = env(name);
  return value && value.trim() ? value.trim() : fallback;
}

function inferKind(path) {
  return String(path).toLowerCase().endsWith('.app') ? 'App' : 'Blob';
}
