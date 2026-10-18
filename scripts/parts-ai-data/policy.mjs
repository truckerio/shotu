import { createHash } from 'node:crypto';

export const COMMONS_API_URL = 'https://commons.wikimedia.org/w/api.php';
export const COMMONS_IMAGE_HOST = 'upload.wikimedia.org';
export const DEFAULT_SOURCE_LIMIT = 5;
export const MAX_SOURCE_LIMIT = 10;
export const MAX_TOTAL_RESULTS = 20;
export const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_METADATA_BYTES = 2 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 15_000;

const DISALLOWED_LICENSE_PATTERNS = [
  /\bnoncommercial\b/i,
  /\bno derivatives\b/i,
  /\bcc[ -]?by[ -]?nc\b/i,
  /\bcc[ -]?by[ -]?nd\b/i,
  /\bcc[ -]?by[ -]?sa\b/i,
];

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function metadataValue(value) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && typeof value.value === 'string') {
    return value.value.trim();
  }
  return '';
}

export function normalizeLicenseText(value) {
  return metadataValue(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/[©®]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isExactAllowedLicense(value) {
  return /^(?:cc0|cc 0)(?: 1\.0)?$/.test(value)
    || /^creative commons (?:cc0|zero)(?: 1\.0)?(?: universal)?$/.test(value)
    || /^public domain(?: mark(?: 1\.0)?)?$/.test(value)
    || /^cc by (?:1\.0|2\.0|2\.5|3\.0|4\.0)$/.test(value)
    || /^creative commons attribution (?:1\.0|2\.0|2\.5|3\.0|4\.0)$/.test(value);
}

export function evaluateDownloadLicense(extmetadata = {}) {
  const name = metadataValue(extmetadata.LicenseShortName);
  const candidates = [extmetadata.LicenseShortName, extmetadata.UsageTerms]
    .map(normalizeLicenseText)
    .filter(Boolean);
  const restrictions = normalizeLicenseText(extmetadata.Restrictions);
  const text = [...candidates, restrictions].join(' ');
  if (candidates.length === 0) {
    return { allowed: false, reason: 'missing explicit license metadata', name: '' };
  }
  if (restrictions || DISALLOWED_LICENSE_PATTERNS.some((pattern) => pattern.test(text))) {
    return { allowed: false, reason: 'license includes unsupported restrictions', name };
  }
  if (!candidates.every(isExactAllowedLicense)) {
    return { allowed: false, reason: 'license metadata is not an exact allowlist match', name };
  }
  return { allowed: true, reason: 'explicit Commons license allowlist match', name };
}

export function assertCommonsImageUrl(value, contentHosts = [COMMONS_IMAGE_HOST]) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('image URL is invalid');
  }
  const allowedHosts = new Set(contentHosts.length ? contentHosts : [COMMONS_IMAGE_HOST]);
  if (url.protocol !== 'https:' || url.port && url.port !== '443') {
    throw new Error('image URL must use HTTPS on port 443');
  }
  if (url.username || url.password) throw new Error('image URL must not contain userinfo');
  if (!allowedHosts.has(url.hostname) || url.hostname !== COMMONS_IMAGE_HOST) {
    throw new Error(`image host is not allowed: ${url.hostname}`);
  }
  return url;
}

export function validateRegistry(registry) {
  if (!registry || registry.version !== 1 || !Array.isArray(registry.sources)) {
    throw new Error('registry must have version 1 and a sources array');
  }
  const ids = new Set();
  return registry.sources.map((source, index) => {
    if (!source || typeof source !== 'object') throw new Error(`source ${index} must be an object`);
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(source.id ?? '')) throw new Error(`source ${index} has an invalid id`);
    if (ids.has(source.id)) throw new Error(`duplicate source id: ${source.id}`);
    ids.add(source.id);
    if (!['commons_search', 'reference'].includes(source.kind)) throw new Error(`unsupported source kind: ${source.kind}`);
    if (!['candidate', 'permission_required', 'excluded'].includes(source.trainingStatus)) {
      throw new Error(`source ${source.id} has an invalid trainingStatus`);
    }
    for (const field of ['url', 'licenseEvidenceUrl']) {
      try { new URL(source[field]); } catch { throw new Error(`source ${source.id} has an invalid ${field}`); }
    }
    if (source.kind === 'commons_search' && !String(source.query ?? '').trim()) {
      throw new Error(`Commons source ${source.id} needs a query`);
    }
    const requestedLimit = source.limit ?? DEFAULT_SOURCE_LIMIT;
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1) throw new Error(`source ${source.id} has an invalid limit`);
    const contentHosts = source.contentHosts ?? [COMMONS_IMAGE_HOST];
    if (!Array.isArray(contentHosts) || contentHosts.some((host) => host !== COMMONS_IMAGE_HOST)) {
      throw new Error(`source ${source.id} may only use ${COMMONS_IMAGE_HOST}`);
    }
    return { ...source, limit: Math.min(requestedLimit, MAX_SOURCE_LIMIT), contentHosts };
  });
}

export async function readResponseBytes(response, maxBytes) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`response exceeds ${maxBytes} bytes`);
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error(`response exceeds ${maxBytes} bytes`);
    return bytes;
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    total += bytes.byteLength;
    if (total > maxBytes) {
      try { await response.body.cancel?.(); } catch {}
      throw new Error(`response exceeds ${maxBytes} bytes`);
    }
    chunks.push(bytes);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export function detectImageType(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return { mime: 'image/png', extension: 'png' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg', extension: 'jpg' };
  }
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') {
    return { mime: 'image/webp', extension: 'webp' };
  }
  throw new Error('content is not a supported JPEG, PNG, or WebP image');
}

export function assertMatchingContentType(headerValue, detected) {
  const mime = String(headerValue ?? '').split(';', 1)[0].trim().toLowerCase();
  const aliases = detected.mime === 'image/jpeg' ? new Set(['image/jpeg', 'image/jpg']) : new Set([detected.mime]);
  if (!aliases.has(mime)) throw new Error(`content-type ${mime || '(missing)'} does not match ${detected.mime}`);
}
