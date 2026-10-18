#!/usr/bin/env node
import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { detectImageType, sha256 } from './policy.mjs';

const SPLITS = new Set(['train', 'validation', 'test']);
const PROHIBITED_LABEL_KEYS = new Set(['sku', 'exactsku', 'partnumber', 'oempartnumber', 'fitment']);

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'w' });
  await rename(temporary, filePath);
}

function assertNoSkuAssertions(value, trail = 'review') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (PROHIBITED_LABEL_KEYS.has(key.toLowerCase())) {
      throw new Error(`${trail}.${key} is prohibited; visual categories cannot assert exact SKU or fitment`);
    }
    assertNoSkuAssertions(child, `${trail}.${key}`);
  }
}

function validDate(value) {
  return typeof value === 'string' && value.trim() && !Number.isNaN(Date.parse(value));
}

function requireWebUrl(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be a URL`); }
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error(`${label} must use HTTP or HTTPS`);
  return url.href;
}

export function imageDimensions(bytes) {
  const type = detectImageType(bytes);
  if (type.mime === 'image/png') {
    if (bytes.length < 24) throw new Error('PNG is too short for dimensions');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20), ...type };
  }
  if (type.mime === 'image/jpeg') {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (length < 2 || offset + 2 + length > bytes.length) throw new Error('invalid JPEG segment');
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: (bytes[offset + 7] << 8) | bytes[offset + 8], height: (bytes[offset + 5] << 8) | bytes[offset + 6], ...type };
      }
      offset += 2 + length;
    }
    throw new Error('JPEG dimensions were not found');
  }
  const chunk = new TextDecoder().decode(bytes.slice(12, 16));
  if (chunk === 'VP8X' && bytes.length >= 30) {
    const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
    const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    return { width, height, ...type };
  }
  if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: ((bytes[27] << 8) | bytes[26]) & 0x3fff, height: ((bytes[29] << 8) | bytes[28]) & 0x3fff, ...type };
  }
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
    const height = 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10);
    return { width, height, ...type };
  }
  throw new Error('WebP dimensions were not found');
}

function validateReviewBasics(review) {
  if (!review || typeof review !== 'object') throw new Error('review record must be an object');
  assertNoSkuAssertions(review);
  if (typeof review.observationId !== 'string' || !review.observationId) throw new Error('review observationId is required');
  if (typeof review.trainingApproved !== 'boolean') throw new Error(`review ${review.observationId} needs trainingApproved boolean`);
  if (typeof review.reviewedBy !== 'string' || !review.reviewedBy.trim()) throw new Error(`review ${review.observationId} needs reviewedBy`);
  if (!validDate(review.reviewedAt)) throw new Error(`review ${review.observationId} needs a valid reviewedAt`);
  if (!review.licenseApproval || review.licenseApproval.approved !== true) {
    if (review.trainingApproved) throw new Error(`review ${review.observationId} has no approved license decision`);
  }
  if (review.trainingApproved) requireWebUrl(review.licenseApproval.evidenceUrl, `review ${review.observationId} license evidence`);
  if (review.trainingApproved && (typeof review.licenseApproval.observedLicenseHash !== 'string' || !/^[a-f0-9]{64}$/.test(review.licenseApproval.observedLicenseHash))) {
    throw new Error(`review ${review.observationId} needs the observedLicenseHash it approved`);
  }
  if (review.trainingApproved && (typeof review.licenseApproval.observedLicenseEventId !== 'string' || !/^[a-f0-9]{64}:[1-9]\d*$/.test(review.licenseApproval.observedLicenseEventId))) {
    throw new Error(`review ${review.observationId} needs the observedLicenseEventId it approved`);
  }
}

function validateApprovedAnnotation(review, dimensions) {
  if (!SPLITS.has(review.split)) throw new Error(`review ${review.observationId} needs explicit train, validation, or test split`);
  if (typeof review.groupKey !== 'string' || !review.groupKey.trim()) throw new Error(`review ${review.observationId} needs a truck/session groupKey`);
  if (typeof review.category !== 'string' || !review.category.trim()) throw new Error(`review ${review.observationId} needs a visual category`);
  if (!Number.isInteger(review.imageWidth) || !Number.isInteger(review.imageHeight) || review.imageWidth <= 0 || review.imageHeight <= 0) {
    throw new Error(`review ${review.observationId} needs positive integer imageWidth and imageHeight`);
  }
  if (review.imageWidth !== dimensions.width || review.imageHeight !== dimensions.height) {
    throw new Error(`review ${review.observationId} dimensions do not match the image`);
  }
  if (!Array.isArray(review.boxes) || review.boxes.length === 0) throw new Error(`review ${review.observationId} needs at least one bounding box`);
  for (const [index, box] of review.boxes.entries()) {
    for (const field of ['x', 'y', 'width', 'height']) {
      if (!Number.isFinite(box?.[field])) throw new Error(`review ${review.observationId} box ${index} has invalid ${field}`);
    }
    if (box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0 || box.x + box.width > dimensions.width || box.y + box.height > dimensions.height) {
      throw new Error(`review ${review.observationId} box ${index} is outside image bounds`);
    }
    if (box.category !== undefined && (typeof box.category !== 'string' || !box.category.trim())) {
      throw new Error(`review ${review.observationId} box ${index} has an invalid category`);
    }
  }
}

function resolveAssetPath(manifestPath, localPath) {
  if (typeof localPath !== 'string' || !localPath) throw new Error('manifest asset has no localPath');
  const root = path.dirname(path.resolve(manifestPath));
  const resolved = path.resolve(root, localPath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error('manifest asset path escapes its directory');
  return resolved;
}

export async function exportReviewedDataset({ manifestPath, reviewsPath, outputDir, now = () => new Date().toISOString() } = {}) {
  if (!manifestPath || !reviewsPath || !outputDir) throw new Error('manifestPath, reviewsPath, and outputDir are required');
  const [manifest, reviewsDocument] = await Promise.all([readJson(manifestPath), readJson(reviewsPath)]);
  if (manifest?.version !== 1 || !Array.isArray(manifest.observations)) throw new Error('manifest must have version 1 and observations');
  if (reviewsDocument?.version !== 1 || !Array.isArray(reviewsDocument.records)) throw new Error('reviews must have version 1 and records');
  const datasetVersion = reviewsDocument.datasetVersion;
  if (typeof datasetVersion !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(datasetVersion)) throw new Error('reviews need a filesystem-safe datasetVersion');

  const observationsById = new Map(manifest.observations.map((item) => [item.id, item]));
  const reviewsById = new Map();
  for (const review of reviewsDocument.records) {
    validateReviewBasics(review);
    if (reviewsById.has(review.observationId)) throw new Error(`duplicate review for ${review.observationId}`);
    if (!observationsById.has(review.observationId)) throw new Error(`review references unknown observation ${review.observationId}`);
    reviewsById.set(review.observationId, review);
  }
  const downloadable = manifest.observations.filter((item) => item.kind === 'commons_image' && item.asset);
  for (const observation of downloadable) {
    if (!reviewsById.has(observation.id)) throw new Error(`missing review for downloaded observation ${observation.id}`);
  }

  const approved = [];
  for (const observation of downloadable) {
    const review = reviewsById.get(observation.id);
    if (!review.trainingApproved) continue;
    if (observation.active !== true || observation.trainingStatus !== 'candidate' || observation.license?.downloadAllowedByPolicy !== true) {
      throw new Error(`observation ${observation.id} is not license-eligible in the manifest`);
    }
    const latestLicenseObservation = Array.isArray(observation.licenseObservations) ? observation.licenseObservations.at(-1) : null;
    if (!latestLicenseObservation
      || latestLicenseObservation.eventId !== observation.licenseObservationEventId
      || latestLicenseObservation.hash !== observation.licenseObservationHash) {
      throw new Error(`observation ${observation.id} has inconsistent current license history`);
    }
    if (review.licenseApproval.observedLicenseHash !== observation.licenseObservationHash) {
      throw new Error(`review ${observation.id} approved a stale license observation`);
    }
    if (review.licenseApproval.observedLicenseEventId !== observation.licenseObservationEventId) {
      throw new Error(`review ${observation.id} approved a stale license observation event`);
    }
    requireWebUrl(observation.originalPageUrl, `observation ${observation.id} source page`);
    requireWebUrl(observation.license?.url, `observation ${observation.id} source license`);
    const assetPath = resolveAssetPath(manifestPath, observation.asset.localPath);
    const bytes = new Uint8Array(await readFile(assetPath));
    const digest = sha256(bytes);
    if (digest !== observation.asset.sha256) throw new Error(`asset hash mismatch for ${observation.id}`);
    const dimensions = imageDimensions(bytes);
    if (dimensions.mime !== observation.asset.mime) throw new Error(`asset MIME mismatch for ${observation.id}`);
    validateApprovedAnnotation(review, dimensions);
    approved.push({ observation, review, assetPath, dimensions, digest });
  }
  if (approved.length === 0) throw new Error('no training-approved observations to export');

  const hashSplits = new Map();
  const groupSplits = new Map();
  for (const item of approved) {
    const priorHashSplit = hashSplits.get(item.digest);
    if (priorHashSplit && priorHashSplit !== item.review.split) throw new Error(`image hash ${item.digest} leaks across splits`);
    hashSplits.set(item.digest, item.review.split);
    const priorGroupSplit = groupSplits.get(item.review.groupKey);
    if (priorGroupSplit && priorGroupSplit !== item.review.split) throw new Error(`group ${item.review.groupKey} leaks across splits`);
    groupSplits.set(item.review.groupKey, item.review.split);
  }

  approved.sort((a, b) => a.observation.id.localeCompare(b.observation.id));
  const categoryNames = [...new Set(approved.flatMap(({ review }) => review.boxes.map((box) => box.category || review.category)))].sort();
  const categoryIds = new Map(categoryNames.map((name, index) => [name, index + 1]));
  const versionDir = path.join(path.resolve(outputDir), datasetVersion);
  await mkdir(path.resolve(outputDir), { recursive: true });
  try {
    await access(versionDir);
    throw new Error(`dataset version already exists: ${datasetVersion}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const stagingDir = path.join(path.resolve(outputDir), `.${datasetVersion}.tmp-${process.pid}`);
  const imagesDir = path.join(stagingDir, 'images');
  try {
    await mkdir(imagesDir, { recursive: true });
    let annotationId = 1;
    const cocoImages = [];
    const cocoAnnotations = [];
    const provenanceItems = [];
    const attributionItems = [];
    for (const [index, item] of approved.entries()) {
      const imageId = index + 1;
      const extension = item.observation.asset.localPath.split('.').pop().toLowerCase();
      const fileName = `${item.digest}.${extension}`;
      await copyFile(item.assetPath, path.join(imagesDir, fileName));
      cocoImages.push({ id: imageId, file_name: `images/${fileName}`, width: item.dimensions.width, height: item.dimensions.height, split: item.review.split });
      for (const box of item.review.boxes) {
        cocoAnnotations.push({
          id: annotationId++, image_id: imageId, category_id: categoryIds.get(box.category || item.review.category),
          bbox: [box.x, box.y, box.width, box.height], area: box.width * box.height, iscrowd: 0,
        });
      }
      provenanceItems.push({
        imageId, observationId: item.observation.id, sha256: item.digest, sourceId: item.observation.sourceId,
        originalPageUrl: item.observation.originalPageUrl, originalImageUrl: item.observation.originalImageUrl,
        retrievedAt: item.observation.retrievedAt, lastSeenAt: item.observation.lastSeenAt,
        licenseObservationHash: item.observation.licenseObservationHash,
        licenseObservationEventId: item.observation.licenseObservationEventId,
        license: item.observation.license, rawMetadata: item.observation.rawMetadata,
        licenseObservations: item.observation.licenseObservations,
        groupKey: item.review.groupKey, split: item.review.split, reviewedBy: item.review.reviewedBy,
        reviewedAt: item.review.reviewedAt, trainingApproved: true,
        licenseApprovalEvidenceUrl: item.review.licenseApproval.evidenceUrl,
      });
      attributionItems.push({
        imageId, title: item.observation.title || '', author: item.observation.author || '',
        sourceUrl: item.observation.originalPageUrl, licenseName: item.observation.license.name,
        licenseUrl: item.observation.license.url,
      });
    }
    const createdAt = now();
    await Promise.all([
      writeJsonAtomic(path.join(stagingDir, 'annotations.coco.json'), {
        info: { version: datasetVersion, createdAt, description: 'Human-reviewed truck-parts visual-category dataset' },
        licenses: [], categories: categoryNames.map((name) => ({ id: categoryIds.get(name), name })),
        images: cocoImages, annotations: cocoAnnotations,
      }),
      writeJsonAtomic(path.join(stagingDir, 'provenance.json'), { version: 1, datasetVersion, createdAt, items: provenanceItems }),
      writeJsonAtomic(path.join(stagingDir, 'attribution.json'), { version: 1, datasetVersion, createdAt, items: attributionItems }),
    ]);
    await rename(stagingDir, versionDir);
    return {
      versionDir,
      cocoPath: path.join(versionDir, 'annotations.coco.json'),
      provenancePath: path.join(versionDir, 'provenance.json'),
      attributionPath: path.join(versionDir, 'attribution.json'),
      images: cocoImages.length,
      annotations: cocoAnnotations.length,
    };
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    if (error.code === 'EEXIST' || error.code === 'ENOTEMPTY') throw new Error(`dataset version already exists: ${datasetVersion}`);
    throw error;
  }
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--manifest') result.manifestPath = argv[++index];
    else if (arg === '--reviews') result.reviewsPath = argv[++index];
    else if (arg === '--output-dir') result.outputDir = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!result.manifestPath || !result.reviewsPath || !result.outputDir) {
    throw new Error('usage: dataset.mjs --manifest PATH --reviews PATH --output-dir DIR');
  }
  for (const key of ['manifestPath', 'reviewsPath', 'outputDir']) result[key] = path.resolve(result[key]);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await exportReviewedDataset(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`dataset export failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
