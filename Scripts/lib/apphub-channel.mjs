export const stableChannel = 'stable';
export const stableReleaseTag = 'remote-demo-v1';
export const channelReleaseTagPrefix = 'apphub-channel-';

export function normalizeChannel(channel) {
  const normalized = String(channel ?? '').trim();
  return normalized || stableChannel;
}

export function safeChannelName(channel) {
  const normalized = normalizeChannel(channel);
  let out = '';
  let lastWasDash = false;
  for (const ch of normalized) {
    if (/^[A-Za-z0-9._-]$/.test(ch)) {
      out += ch;
      lastWasDash = false;
    } else if (!lastWasDash) {
      out += '-';
      lastWasDash = true;
    }
  }
  out = out.replace(/^-+|-+$/g, '');
  return out || stableChannel;
}

export function releaseTagForChannel(channel, fallbackStableTag = stableReleaseTag) {
  const normalized = normalizeChannel(channel);
  if (normalized === stableChannel) return fallbackStableTag;
  return `${channelReleaseTagPrefix}${safeChannelName(normalized)}`;
}
