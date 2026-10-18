#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  COMMONS_API_URL,
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_MAX_METADATA_BYTES,
  DEFAULT_TIMEOUT_MS,
  MAX_TOTAL_RESULTS,
  assertCommonsImageUrl,
  assertMatchingContentType,
  detectImageType,
  evaluateDownloadLicense,
  metadataValue,
  normalizeLicenseText,
  readResponseBytes,
  sha256,
  validateRegistry,
} from './policy.mjs';

const USER_AGENT = 'WorkorderPartsAIFoundation/1.0 (bounded public-data research; contact: local repository owner)';

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readJsonIfPresent(filePath, fallback) {
  try { return await readJson(filePath); } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'w' });
  await rename(temporary, filePath);
}

function fetchOptions(signal) {
  return { redirect: 'manual', signal, headers: { accept: 'application/json', 'user-agent': USER_AGENT } };
}

function commonsApiUrl(source) {
  const url = new URL(COMMONS_API_URL);
  url.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: source.query,
    gsrnamespace: '6',
    gsrlimit: String(source.limit),
    prop: 'info|imageinfo',
    inprop: 'url',
    iiprop: 'url|mime|extmetadata',
    iilimit: '1',
  }).toString();
  return url;
}

async function fetchCommonsPages(source, { fetchImpl, timeoutMs, maxMetadataBytes }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`request timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    const response = await fetchImpl(commonsApiUrl(source), fetchOptions(controller.signal));
    if (response.status >= 300 && response.status < 400) throw new Error('Commons metadata API redirect rejected');
    if (!response.ok) throw new Error(`Commons metadata API returned HTTP ${response.status}`);
    const contentType = response.headers?.get?.('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) throw new Error('Commons metadata API did not return JSON');
    const bytes = await readResponseBytes(response, maxMetadataBytes);
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (data.error) throw new Error(`Commons metadata API error: ${data.error.code ?? 'unknown'}`);
    return Array.isArray(data.query?.pages) ? data.query.pages : [];
  } finally {
    clearTimeout(timer);
  }
}

function observationFromCommonsPage(source, page, retrievedAt) {
  const info = page.imageinfo?.[0];
  if (!info?.url) throw new Error(`Commons page ${page.pageid ?? page.title ?? '(unknown)'} has no image URL`);
  const imageUrl = assertCommonsImageUrl(info.url, source.contentHosts).href;
  const extmetadata = info.extmetadata && typeof info.extmetadata === 'object' ? info.extmetadata : {};
  const pageUrl = page.fullurl || `https://commons.wikimedia.org/?curid=${encodeURIComponent(page.pageid)}`;
  const licenseUrl = metadataValue(extmetadata.LicenseUrl) || pageUrl;
  const license = evaluateDownloadLicense(extmetadata);
  const licenseSnapshot = {
    name: license.name || metadataValue(extmetadata.UsageTerms),
    url: licenseUrl,
    rawMetadata: extmetadata,
  };
  const licenseRightsEvidence = {
    name: normalizeLicenseText(licenseSnapshot.name),
    url: new URL(licenseSnapshot.url).href,
    usageTerms: normalizeLicenseText(extmetadata.UsageTerms),
    restrictions: normalizeLicenseText(extmetadata.Restrictions),
    copyrighted: normalizeLicenseText(extmetadata.Copyrighted),
    attributionRequired: normalizeLicenseText(extmetadata.AttributionRequired),
    downloadAllowedByPolicy: source.trainingStatus === 'candidate' && license.allowed,
    policyReason: source.trainingStatus === 'candidate' ? license.reason : `source status is ${source.trainingStatus}`,
  };
  const licenseObservationHash = sha256(stableStringify(licenseRightsEvidence));
  const licenseObservationEventId = `${licenseObservationHash}:1`;
  return {
    id: sha256(`${source.id}\0${pageUrl}\0${imageUrl}`),
    sourceId: source.id,
    kind: 'commons_image',
    trainingStatus: source.trainingStatus,
    active: source.trainingStatus === 'candidate',
    categoryHint: source.query,
    originalPageUrl: pageUrl,
    originalImageUrl: imageUrl,
    title: String(page.title ?? ''),
    author: metadataValue(extmetadata.Artist) || metadataValue(extmetadata.Credit),
    license: {
      name: licenseSnapshot.name,
      url: licenseUrl,
      downloadAllowedByPolicy: source.trainingStatus === 'candidate' && license.allowed,
      policyReason: source.trainingStatus === 'candidate' ? license.reason : `source status is ${source.trainingStatus}`,
    },
    rawMetadata: extmetadata,
    licenseObservationHash,
    licenseObservationEventId,
    licenseObservations: [{ eventId: licenseObservationEventId, hash: licenseObservationHash, observedAt: retrievedAt, rightsEvidence: licenseRightsEvidence, ...licenseSnapshot }],
    retrievedAt,
    lastSeenAt: retrievedAt,
  };
}

function referenceObservation(source, retrievedAt) {
  return {
    id: sha256(`${source.id}\0${source.url}`),
    sourceId: source.id,
    kind: 'reference',
    trainingStatus: source.trainingStatus,
    active: false,
    categoryHint: source.query || null,
    originalPageUrl: source.url,
    license: {
      name: '',
      url: source.licenseEvidenceUrl,
      downloadAllowedByPolicy: false,
      policyReason: 'reference sources are never bulk-downloaded',
    },
    notes: source.notes || '',
    retrievedAt,
    lastSeenAt: retrievedAt,
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function fetchImageFollowingSafeRedirects(urlValue, source, options) {
  let url = assertCommonsImageUrl(urlValue, source.contentHosts);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`request timed out after ${options.timeoutMs}ms`)), options.timeoutMs);
    try {
      const response = await options.fetchImpl(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: 'image/jpeg,image/png,image/webp', 'user-agent': USER_AGENT },
      });
      if (response.status >= 300 && response.status < 400) {
        if (redirects === 3) throw new Error('image redirect limit exceeded');
        const location = response.headers?.get?.('location');
        if (!location) throw new Error('image redirect has no location');
        url = assertCommonsImageUrl(new URL(location, url).href, source.contentHosts);
        continue;
      }
      if (!response.ok) throw new Error(`image request returned HTTP ${response.status}`);
      const bytes = await readResponseBytes(response, options.maxImageBytes);
      return { bytes, contentType: response.headers?.get?.('content-type'), finalUrl: url.href };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('image redirect limit exceeded');
}

export async function downloadCommonsImage(observation, source, options) {
  if (observation.kind !== 'commons_image' || !observation.license?.downloadAllowedByPolicy) {
    throw new Error('observation is not eligible for download');
  }
  const { bytes, contentType, finalUrl } = await fetchImageFollowingSafeRedirects(observation.originalImageUrl, source, options);
  const detected = detectImageType(bytes);
  assertMatchingContentType(contentType, detected);
  const digest = sha256(bytes);
  const imagesDir = path.join(options.outputDir, 'images');
  await mkdir(imagesDir, { recursive: true });
  const filePath = path.join(imagesDir, `${digest}.${detected.extension}`);
  try {
    await writeFile(filePath, bytes, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  return {
    sha256: digest,
    bytes: bytes.byteLength,
    mime: detected.mime,
    localPath: path.relative(options.outputDir, filePath),
    downloadedFrom: finalUrl,
  };
}

function mergeObservation(previous, current) {
  if (!previous) return current;
  const preservedReviewFields = {};
  for (const key of ['humanReview', 'review', 'annotations']) {
    if (Object.hasOwn(previous, key)) preservedReviewFields[key] = previous[key];
  }
  const previousLicenseObservations = Array.isArray(previous.licenseObservations) && previous.licenseObservations.length
    ? normalizeLicenseObservationEvents(previous.licenseObservations)
    : legacyLicenseObservation(previous);
  const mergedLicenseObservations = [...previousLicenseObservations];
  for (const event of current.licenseObservations ?? []) {
    if (mergedLicenseObservations.at(-1)?.hash !== event.hash) {
      mergedLicenseObservations.push({ ...event, eventId: `${event.hash}:${mergedLicenseObservations.length + 1}` });
    }
  }
  const latestLicenseObservation = mergedLicenseObservations.at(-1);
  return {
    ...current,
    ...preservedReviewFields,
    retrievedAt: previous.retrievedAt || current.retrievedAt,
    lastSeenAt: current.lastSeenAt,
    ...(mergedLicenseObservations.length ? { licenseObservations: mergedLicenseObservations } : {}),
    ...(latestLicenseObservation ? { licenseObservationEventId: latestLicenseObservation.eventId } : {}),
    ...(previous.asset && !current.asset ? { asset: previous.asset } : {}),
  };
}

function normalizeLicenseObservationEvents(events) {
  return events.map((event, index) => ({
    ...event,
    eventId: event.eventId || `${event.hash}:${index + 1}`,
  }));
}

function legacyLicenseObservation(observation) {
  if (!observation.license || !observation.rawMetadata) return [];
  const rightsEvidence = {
    name: normalizeLicenseText(observation.license.name || ''),
    url: new URL(observation.license.url || observation.originalPageUrl).href,
    usageTerms: normalizeLicenseText(observation.rawMetadata.UsageTerms),
    restrictions: normalizeLicenseText(observation.rawMetadata.Restrictions),
    copyrighted: normalizeLicenseText(observation.rawMetadata.Copyrighted),
    attributionRequired: normalizeLicenseText(observation.rawMetadata.AttributionRequired),
    downloadAllowedByPolicy: observation.license.downloadAllowedByPolicy === true,
    policyReason: observation.license.policyReason || '',
  };
  const hash = observation.licenseObservationHash || sha256(stableStringify(rightsEvidence));
  return [{
    eventId: `${hash}:1`,
    hash,
    observedAt: observation.lastSeenAt || observation.retrievedAt,
    rightsEvidence,
    name: observation.license.name || '',
    url: observation.license.url || observation.originalPageUrl || '',
    rawMetadata: observation.rawMetadata,
  }];
}

function applyRegistryEligibility(previous, sourcesById) {
  const source = sourcesById.get(previous.sourceId);
  const currentCandidate = source?.kind === 'commons_search' && source.trainingStatus === 'candidate';
  if (currentCandidate) return { ...previous, active: true, trainingStatus: 'candidate' };
  const trainingStatus = source?.trainingStatus ?? 'removed';
  return {
    ...previous,
    active: false,
    trainingStatus,
    license: previous.license ? {
      ...previous.license,
      downloadAllowedByPolicy: false,
      policyReason: source ? `source status is ${trainingStatus}` : 'source was removed from the registry',
    } : previous.license,
  };
}

export async function collectRegistry({
  registryPath,
  outputDir,
  download = false,
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxMetadataBytes = DEFAULT_MAX_METADATA_BYTES,
  maxImageBytes = DEFAULT_MAX_IMAGE_BYTES,
  maxTotalResults = MAX_TOTAL_RESULTS,
} = {}) {
  if (!registryPath || !outputDir) throw new Error('registryPath and outputDir are required');
  if (typeof fetchImpl !== 'function') throw new Error('a fetch implementation is required');
  if (!Number.isInteger(maxTotalResults) || maxTotalResults < 1) throw new Error('maxTotalResults must be a positive integer');
  maxTotalResults = Math.min(maxTotalResults, MAX_TOTAL_RESULTS);
  const registry = await readJson(registryPath);
  const sources = validateRegistry(registry);
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const manifestPath = path.join(outputDir, 'manifest.json');
  const previous = await readJsonIfPresent(manifestPath, { observations: [] });
  const previousById = new Map((previous.observations ?? []).map((item) => [item.id, item]));
  const observationsById = new Map([...previousById].map(([id, item]) => [id, applyRegistryEligibility(item, sourcesById)]));
  const failures = [];
  const runAt = now();
  let collectedThisRun = 0;
  let attemptedThisRun = 0;
  let metadataRequestsThisRun = 0;
  let downloadedThisRun = 0;
  let downloadsPausedAfterRateLimit = false;
  let commonsMetadataPausedAfterRateLimit = false;

  for (const source of sources) {
    if (source.kind === 'reference') {
      const observation = referenceObservation(source, runAt);
      observationsById.set(observation.id, mergeObservation(previousById.get(observation.id), observation));
      continue;
    }
    if (source.trainingStatus === 'excluded' || commonsMetadataPausedAfterRateLimit) continue;
    const remaining = Math.max(0, maxTotalResults - attemptedThisRun);
    if (remaining === 0) continue;
    try {
      if (metadataRequestsThisRun >= MAX_TOTAL_RESULTS) continue;
      metadataRequestsThisRun += 1;
      const pages = await fetchCommonsPages({ ...source, limit: Math.min(source.limit, remaining) }, { fetchImpl, timeoutMs, maxMetadataBytes });
      for (const page of pages.slice(0, remaining)) {
        attemptedThisRun += 1;
        try {
          let observation = observationFromCommonsPage(source, page, runAt);
          const prior = previousById.get(observation.id);
          if (download && observation.license.downloadAllowedByPolicy && !downloadsPausedAfterRateLimit) {
            if (prior?.asset) {
              observation.asset = prior.asset;
            } else {
              try {
                observation.asset = await downloadCommonsImage(observation, source, {
                  fetchImpl, timeoutMs, maxImageBytes, outputDir,
                });
                downloadedThisRun += 1;
              } catch (error) {
                observation.downloadError = { at: runAt, message: error.message };
                failures.push({ sourceId: source.id, item: String(page.title ?? page.pageid ?? 'unknown'), error: error.message });
                if (/HTTP 429\b/.test(error.message)) downloadsPausedAfterRateLimit = true;
              }
            }
          }
          observationsById.set(observation.id, mergeObservation(prior, observation));
          collectedThisRun += 1;
        } catch (error) {
          failures.push({ sourceId: source.id, item: String(page.title ?? page.pageid ?? 'unknown'), error: error.message });
        }
      }
    } catch (error) {
      failures.push({ sourceId: source.id, error: error.message });
      if (/HTTP 429\b/.test(error.message)) commonsMetadataPausedAfterRateLimit = true;
    }
  }

  const manifest = {
    version: 1,
    registryVersion: registry.version,
    updatedAt: runAt,
    observations: [...observationsById.values()].sort((a, b) => a.id.localeCompare(b.id)),
    lastRun: {
      at: runAt,
      downloadRequested: Boolean(download),
      collected: collectedThisRun,
      attempted: attemptedThisRun,
      metadataRequests: metadataRequestsThisRun,
      downloaded: downloadedThisRun,
      failures: failures.sort((a, b) => `${a.sourceId}:${a.item ?? ''}`.localeCompare(`${b.sourceId}:${b.item ?? ''}`)),
    },
  };
  await writeJsonAtomic(manifestPath, manifest);
  return { manifestPath, observations: manifest.observations.length, collectedThisRun, downloadedThisRun, failures: failures.length };
}

function parseArgs(argv) {
  const result = { download: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--download') result.download = true;
    else if (arg === '--registry') result.registryPath = argv[++index];
    else if (arg === '--output-dir') result.outputDir = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!result.registryPath || !result.outputDir) throw new Error('usage: collect.mjs --registry PATH --output-dir DIR [--download]');
  result.registryPath = path.resolve(result.registryPath);
  result.outputDir = path.resolve(result.outputDir);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await collectRegistry(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`collection failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
