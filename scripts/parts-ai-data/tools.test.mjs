import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectRegistry, downloadCommonsImage } from './collect.mjs';
import { exportReviewedDataset } from './dataset.mjs';
import { evaluateDownloadLicense, sha256, validateRegistry } from './policy.mjs';

const PNG_4_BY_3 = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x03,
]);

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

function registry(sources) {
  return { version: 1, sources };
}

function commonsSource(overrides = {}) {
  return {
    id: 'commons-alternators',
    kind: 'commons_search',
    url: 'https://example.invalid/untrusted-registry-url',
    query: 'truck alternator',
    limit: 5,
    trainingStatus: 'candidate',
    licenseEvidenceUrl: 'https://commons.wikimedia.org/wiki/Commons:Licensing',
    ...overrides,
  };
}

test('registry and license policy fail closed', () => {
  assert.equal(validateRegistry(registry([commonsSource({ limit: 99 })]))[0].limit, 10);
  assert.throws(() => validateRegistry(registry([commonsSource({ contentHosts: ['example.com'] })])), /only use upload\.wikimedia\.org/);
  assert.equal(evaluateDownloadLicense({ LicenseShortName: { value: 'CC BY 4.0' } }).allowed, true);
  assert.equal(evaluateDownloadLicense({ LicenseShortName: { value: 'CC BY' } }).allowed, false);
  assert.equal(evaluateDownloadLicense({ LicenseShortName: { value: 'CC BY-NC 4.0' } }).allowed, false);
  assert.equal(evaluateDownloadLicense({ LicenseShortName: { value: 'Creative Commons Attribution-Share Alike 4.0' } }).allowed, false);
  assert.equal(evaluateDownloadLicense({ LicenseShortName: { value: 'CC BY 4.0 or another license' } }).allowed, false);
  assert.equal(evaluateDownloadLicense({ LicenseShortName: { value: 'Unknown' } }).allowed, false);
});

test('collector pins API, clamps result count, and reruns without duplicates', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'parts-ai-collector-'));
  const registryPath = path.join(temporary, 'sources.json');
  const outputDir = path.join(temporary, 'collected');
  await writeFile(registryPath, JSON.stringify(registry([commonsSource({ limit: 50 })])));
  const requestedUrls = [];
  const fakeFetch = async (url) => {
    requestedUrls.push(String(url));
    const pages = Array.from({ length: 7 }, (_, index) => ({
      pageid: index + 1,
      title: `File:Alternator ${index}.jpg`,
      fullurl: `https://commons.wikimedia.org/wiki/File:Alternator_${index}.jpg`,
      imageinfo: [{
        url: `https://upload.wikimedia.org/example/alternator-${index}.jpg`,
        mime: 'image/jpeg',
        extmetadata: {
          Artist: { value: 'Example creator' },
          LicenseShortName: { value: 'CC BY 4.0' },
          LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0/' },
        },
      }],
    }));
    return jsonResponse({ query: { pages } });
  };
  const first = await collectRegistry({ registryPath, outputDir, fetchImpl: fakeFetch, now: () => '2026-01-01T00:00:00Z' });
  const second = await collectRegistry({ registryPath, outputDir, fetchImpl: fakeFetch, now: () => '2026-01-02T00:00:00Z' });
  assert.equal(first.collectedThisRun, 7);
  assert.equal(second.observations, 7);
  assert.ok(requestedUrls.every((value) => value.startsWith('https://commons.wikimedia.org/w/api.php?')));
  assert.ok(requestedUrls.every((value) => new URL(value).searchParams.get('gsrlimit') === '10'));
  const manifest = JSON.parse(await readFile(second.manifestPath, 'utf8'));
  assert.equal(manifest.observations[0].retrievedAt, '2026-01-01T00:00:00Z');
  assert.equal(manifest.observations[0].lastSeenAt, '2026-01-02T00:00:00Z');
  assert.equal(manifest.observations[0].licenseObservations.length, 1);
});

test('registry removal revokes prior eligibility while a search miss does not', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'parts-ai-authority-'));
  const registryPath = path.join(temporary, 'sources.json');
  const outputDir = path.join(temporary, 'collected');
  await writeFile(registryPath, JSON.stringify(registry([commonsSource({ limit: 1 })])));
  const page = {
    pageid: 1,
    title: 'File:One.png',
    fullurl: 'https://commons.wikimedia.org/wiki/File:One.png',
    imageinfo: [{ url: 'https://upload.wikimedia.org/one.png', extmetadata: { LicenseShortName: { value: 'CC0' } } }],
  };
  const api = async () => jsonResponse({ query: { pages: [page] } });
  await collectRegistry({ registryPath, outputDir, fetchImpl: api, now: () => '2026-01-01T00:00:00Z' });
  await collectRegistry({ registryPath, outputDir, fetchImpl: async () => jsonResponse({ query: { pages: [] } }), now: () => '2026-01-02T00:00:00Z' });
  let manifest = JSON.parse(await readFile(path.join(outputDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.observations[0].active, true);
  await writeFile(registryPath, JSON.stringify(registry([])));
  await collectRegistry({ registryPath, outputDir, fetchImpl: async () => { throw new Error('must not fetch'); }, now: () => '2026-01-03T00:00:00Z' });
  manifest = JSON.parse(await readFile(path.join(outputDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.observations[0].active, false);
  assert.equal(manifest.observations[0].trainingStatus, 'removed');
  assert.equal(manifest.observations[0].license.downloadAllowedByPolicy, false);
});

test('license drift creates a new rights snapshot without redating retrieval', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'parts-ai-license-drift-'));
  const registryPath = path.join(temporary, 'sources.json');
  const outputDir = path.join(temporary, 'collected');
  await writeFile(registryPath, JSON.stringify(registry([commonsSource({ limit: 1 })])));
  const page = (licenseName) => ({
    pageid: 1,
    title: 'File:One.png',
    fullurl: 'https://commons.wikimedia.org/wiki/File:One.png',
    imageinfo: [{ url: 'https://upload.wikimedia.org/one.png', extmetadata: { LicenseShortName: { value: licenseName } } }],
  });
  await collectRegistry({ registryPath, outputDir, fetchImpl: async () => jsonResponse({ query: { pages: [page('CC BY 4.0')] } }), now: () => '2026-01-01T00:00:00Z' });
  const first = JSON.parse(await readFile(path.join(outputDir, 'manifest.json'), 'utf8')).observations[0];
  const legacy = structuredClone(first);
  delete legacy.licenseObservationHash;
  delete legacy.licenseObservations;
  await writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify({ version: 1, observations: [legacy] }));
  await collectRegistry({ registryPath, outputDir, fetchImpl: async () => jsonResponse({ query: { pages: [page('Public domain')] } }), now: () => '2026-01-02T00:00:00Z' });
  const second = JSON.parse(await readFile(path.join(outputDir, 'manifest.json'), 'utf8')).observations[0];
  assert.notEqual(first.licenseObservationHash, second.licenseObservationHash);
  assert.equal(second.licenseObservations.length, 2);
  assert.equal(second.licenseObservationEventId, `${second.licenseObservationHash}:2`);
  assert.equal(second.licenseObservations[0].observedAt, '2026-01-01T00:00:00Z');
  assert.equal(second.licenseObservations[1].observedAt, '2026-01-02T00:00:00Z');
  assert.equal(second.retrievedAt, '2026-01-01T00:00:00Z');
  assert.equal(second.lastSeenAt, '2026-01-02T00:00:00Z');
  const publicDomainWithUnrelatedDrift = page(' Public   Domain ');
  publicDomainWithUnrelatedDrift.imageinfo[0].extmetadata.Artist = { value: 'Changed descriptive metadata' };
  await collectRegistry({ registryPath, outputDir, fetchImpl: async () => jsonResponse({ query: { pages: [publicDomainWithUnrelatedDrift] } }), now: () => '2026-01-03T00:00:00Z' });
  const third = JSON.parse(await readFile(path.join(outputDir, 'manifest.json'), 'utf8')).observations[0];
  assert.equal(third.licenseObservationHash, second.licenseObservationHash);
  assert.equal(third.licenseObservations.length, 2);
  await collectRegistry({ registryPath, outputDir, fetchImpl: async () => jsonResponse({ query: { pages: [page('CC BY 4.0')] } }), now: () => '2026-01-04T00:00:00Z' });
  const fourth = JSON.parse(await readFile(path.join(outputDir, 'manifest.json'), 'utf8')).observations[0];
  assert.equal(fourth.licenseObservationHash, first.licenseObservationHash);
  assert.equal(fourth.licenseObservations.length, 3);
  assert.equal(fourth.licenseObservationEventId, `${fourth.licenseObservationHash}:3`);
  assert.notEqual(fourth.licenseObservationEventId, `${first.licenseObservationHash}:1`);
});

test('malformed results and metadata rate limits cannot evade request bounds', async (t) => {
  await t.test('twenty malformed attempted results stop later Commons requests but retain references', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'parts-ai-attempt-cap-'));
    const registryPath = path.join(temporary, 'sources.json');
    const outputDir = path.join(temporary, 'collected');
    const commons = Array.from({ length: 25 }, (_, index) => commonsSource({ id: `commons-${index}`, query: `query-${index}`, limit: 1 }));
    const reference = { id: 'reference-after-cap', kind: 'reference', url: 'https://example.com/reference', trainingStatus: 'permission_required', licenseEvidenceUrl: 'https://example.com/rights' };
    await writeFile(registryPath, JSON.stringify(registry([...commons, reference])));
    let requests = 0;
    const result = await collectRegistry({
      registryPath, outputDir,
      fetchImpl: async () => { requests += 1; return jsonResponse({ query: { pages: [{ pageid: requests, title: `Malformed ${requests}` }] } }); },
    });
    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8'));
    assert.equal(requests, 20);
    assert.equal(manifest.lastRun.attempted, 20);
    assert.equal(manifest.lastRun.metadataRequests, 20);
    assert.ok(manifest.observations.some((item) => item.sourceId === 'reference-after-cap'));
  });
  await t.test('metadata HTTP 429 stops later Commons requests but retains references', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'parts-ai-metadata-429-'));
    const registryPath = path.join(temporary, 'sources.json');
    const outputDir = path.join(temporary, 'collected');
    const reference = { id: 'reference-after-429', kind: 'reference', url: 'https://example.com/reference', trainingStatus: 'permission_required', licenseEvidenceUrl: 'https://example.com/rights' };
    await writeFile(registryPath, JSON.stringify(registry([commonsSource({ id: 'first' }), commonsSource({ id: 'second' }), reference])));
    let requests = 0;
    const result = await collectRegistry({ registryPath, outputDir, fetchImpl: async () => { requests += 1; return jsonResponse({}, { status: 429 }); } });
    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8'));
    assert.equal(requests, 1);
    assert.equal(manifest.lastRun.metadataRequests, 1);
    assert.ok(manifest.observations.some((item) => item.sourceId === 'reference-after-429'));
  });
});

test('download rejects unsafe redirect and oversized or disguised content', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'parts-ai-download-'));
  const source = commonsSource();
  const observation = {
    id: 'one',
    kind: 'commons_image',
    originalImageUrl: 'https://upload.wikimedia.org/example/image.png',
    license: { downloadAllowedByPolicy: true },
  };
  await assert.rejects(
    downloadCommonsImage(observation, source, {
      outputDir: temporary,
      timeoutMs: 100,
      maxImageBytes: 64,
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/image.png' } }),
    }),
    /host is not allowed/,
  );
  await assert.rejects(
    downloadCommonsImage(observation, source, {
      outputDir: temporary,
      timeoutMs: 100,
      maxImageBytes: 8,
      fetchImpl: async () => new Response(PNG_4_BY_3, { headers: { 'content-type': 'image/png' } }),
    }),
    /exceeds 8 bytes/,
  );
  await assert.rejects(
    downloadCommonsImage(observation, source, {
      outputDir: temporary,
      timeoutMs: 100,
      maxImageBytes: 64,
      fetchImpl: async () => new Response(PNG_4_BY_3, { headers: { 'content-type': 'image/jpeg' } }),
    }),
    /does not match image\/png/,
  );
});

test('collector preserves metadata and stops image requests after HTTP 429', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'parts-ai-rate-limit-'));
  const registryPath = path.join(temporary, 'sources.json');
  const outputDir = path.join(temporary, 'collected');
  await writeFile(registryPath, JSON.stringify(registry([commonsSource({ limit: 3 })])));
  let imageRequests = 0;
  const pages = Array.from({ length: 3 }, (_, index) => ({
    pageid: index + 1,
    title: `File:Public domain ${index}.png`,
    fullurl: `https://commons.wikimedia.org/wiki/File:Public_domain_${index}.png`,
    imageinfo: [{
      url: `https://upload.wikimedia.org/example/public-domain-${index}.png`,
      extmetadata: { LicenseShortName: { value: 'Public domain' } },
    }],
  }));
  const result = await collectRegistry({
    registryPath,
    outputDir,
    download: true,
    fetchImpl: async (url) => {
      if (String(url).startsWith('https://commons.wikimedia.org/w/api.php')) return jsonResponse({ query: { pages } });
      imageRequests += 1;
      return new Response('rate limited', { status: 429 });
    },
    now: () => '2026-01-01T00:00:00Z',
  });
  const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8'));
  assert.equal(imageRequests, 1);
  assert.equal(manifest.observations.length, 3);
  assert.match(manifest.observations.find((item) => item.downloadError)?.downloadError.message, /HTTP 429/);
  assert.ok(manifest.observations.every((item) => item.license.url === item.originalPageUrl));
});

async function datasetFixture({ second = false } = {}) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'parts-ai-dataset-'));
  const collectedDir = path.join(temporary, 'collected');
  const imagesDir = path.join(collectedDir, 'images');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(imagesDir, { recursive: true });
  const digest = sha256(PNG_4_BY_3);
  const imagePath = path.join(imagesDir, `${digest}.png`);
  await writeFile(imagePath, PNG_4_BY_3);
  const observations = [{
    id: 'observation-1', sourceId: 'commons-one', kind: 'commons_image', trainingStatus: 'candidate', active: true,
    title: 'Alternator', author: 'Creator', originalPageUrl: 'https://commons.wikimedia.org/wiki/File:One.png',
    originalImageUrl: 'https://upload.wikimedia.org/one.png',
    license: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', downloadAllowedByPolicy: true },
    rawMetadata: { LicenseShortName: { value: 'CC BY 4.0' } },
    licenseObservationHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    licenseObservationEventId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:1',
    licenseObservations: [{ eventId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:1', hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', observedAt: '2026-01-01T00:00:00Z' }],
    retrievedAt: '2026-01-01T00:00:00Z', lastSeenAt: '2026-01-02T00:00:00Z',
    asset: { sha256: digest, mime: 'image/png', localPath: `images/${digest}.png` },
  }];
  if (second) observations.push({ ...observations[0], id: 'observation-2', sourceId: 'commons-two' });
  const manifestPath = path.join(collectedDir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify({ version: 1, observations }));
  const review = (id, overrides = {}) => ({
    observationId: id,
    trainingApproved: true,
    reviewedBy: 'reviewer@example.test',
    reviewedAt: '2026-01-03T00:00:00Z',
    licenseApproval: {
      approved: true,
      evidenceUrl: 'https://commons.wikimedia.org/wiki/File:One.png',
      observedLicenseHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      observedLicenseEventId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:1',
    },
    category: 'alternator',
    imageWidth: 4,
    imageHeight: 3,
    boxes: [{ x: 0, y: 0, width: 4, height: 3 }],
    groupKey: 'truck:unit-100',
    split: 'train',
    ...overrides,
  });
  return { temporary, manifestPath, reviewsPath: path.join(temporary, 'reviews.json'), outputDir: path.join(temporary, 'export'), review, observations };
}

test('dataset export emits COCO plus source and rights records', async () => {
  const fixture = await datasetFixture();
  await writeFile(fixture.reviewsPath, JSON.stringify({ version: 1, datasetVersion: 'pilot-v1', records: [fixture.review('observation-1')] }));
  const result = await exportReviewedDataset({ ...fixture, now: () => '2026-01-04T00:00:00Z' });
  assert.equal(result.images, 1);
  assert.equal(result.annotations, 1);
  const coco = JSON.parse(await readFile(result.cocoPath, 'utf8'));
  const provenance = JSON.parse(await readFile(result.provenancePath, 'utf8'));
  assert.deepEqual(coco.annotations[0].bbox, [0, 0, 4, 3]);
  assert.equal(coco.images[0].split, 'train');
  assert.equal(provenance.items[0].originalPageUrl, 'https://commons.wikimedia.org/wiki/File:One.png');
  assert.equal(provenance.items[0].trainingApproved, true);
  assert.equal(provenance.items[0].licenseObservationHash, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(provenance.items[0].licenseObservationEventId, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:1');
  assert.deepEqual(provenance.items[0].rawMetadata, { LicenseShortName: { value: 'CC BY 4.0' } });
  await assert.rejects(
    exportReviewedDataset({ ...fixture, now: () => '2026-01-04T00:00:00Z' }),
    /dataset version already exists/,
  );
});

test('dataset export rejects missing review, invalid boxes, SKU assertions, and leakage', async (t) => {
  await t.test('missing review', async () => {
    const fixture = await datasetFixture();
    await writeFile(fixture.reviewsPath, JSON.stringify({ version: 1, datasetVersion: 'pilot-v1', records: [] }));
    await assert.rejects(exportReviewedDataset(fixture), /missing review/);
  });
  await t.test('out-of-bounds box', async () => {
    const fixture = await datasetFixture();
    await writeFile(fixture.reviewsPath, JSON.stringify({ version: 1, datasetVersion: 'pilot-v1', records: [fixture.review('observation-1', { boxes: [{ x: 3, y: 0, width: 2, height: 2 }] })] }));
    await assert.rejects(exportReviewedDataset(fixture), /outside image bounds/);
  });
  await t.test('exact SKU assertion', async () => {
    const fixture = await datasetFixture();
    await writeFile(fixture.reviewsPath, JSON.stringify({ version: 1, datasetVersion: 'pilot-v1', records: [fixture.review('observation-1', { sku: 'ABC-123' })] }));
    await assert.rejects(exportReviewedDataset(fixture), /visual categories cannot assert exact SKU/);
  });
  await t.test('stale license approval', async () => {
    const fixture = await datasetFixture();
    const stale = fixture.review('observation-1');
    stale.licenseApproval.observedLicenseHash = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    await writeFile(fixture.reviewsPath, JSON.stringify({ version: 1, datasetVersion: 'pilot-v1', records: [stale] }));
    await assert.rejects(exportReviewedDataset(fixture), /approved a stale license observation/);
  });
  await t.test('old approval is stale after rights return to the same hash', async () => {
    const fixture = await datasetFixture();
    const observation = fixture.observations[0];
    const hashA = observation.licenseObservationHash;
    const hashB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    observation.licenseObservationEventId = `${hashA}:3`;
    observation.licenseObservations = [
      { eventId: `${hashA}:1`, hash: hashA, observedAt: '2026-01-01T00:00:00Z' },
      { eventId: `${hashB}:2`, hash: hashB, observedAt: '2026-01-02T00:00:00Z' },
      { eventId: `${hashA}:3`, hash: hashA, observedAt: '2026-01-03T00:00:00Z' },
    ];
    await writeFile(fixture.manifestPath, JSON.stringify({ version: 1, observations: fixture.observations }));
    const oldApproval = fixture.review('observation-1');
    await writeFile(fixture.reviewsPath, JSON.stringify({ version: 1, datasetVersion: 'pilot-v1', records: [oldApproval] }));
    await assert.rejects(exportReviewedDataset(fixture), /approved a stale license observation event/);
    const freshApproval = fixture.review('observation-1');
    freshApproval.licenseApproval.observedLicenseEventId = `${hashA}:3`;
    await writeFile(fixture.reviewsPath, JSON.stringify({ version: 1, datasetVersion: 'pilot-v1', records: [freshApproval] }));
    const exported = await exportReviewedDataset(fixture);
    assert.equal(exported.images, 1);
  });
  await t.test('inactive observation', async () => {
    const fixture = await datasetFixture();
    fixture.observations[0].active = false;
    await writeFile(fixture.manifestPath, JSON.stringify({ version: 1, observations: fixture.observations }));
    await writeFile(fixture.reviewsPath, JSON.stringify({ version: 1, datasetVersion: 'pilot-v1', records: [fixture.review('observation-1')] }));
    await assert.rejects(exportReviewedDataset(fixture), /not license-eligible/);
  });
  await t.test('same hash across splits', async () => {
    const fixture = await datasetFixture({ second: true });
    await writeFile(fixture.reviewsPath, JSON.stringify({
      version: 1,
      datasetVersion: 'pilot-v1',
      records: [fixture.review('observation-1'), fixture.review('observation-2', { split: 'test', groupKey: 'truck:unit-200' })],
    }));
    await assert.rejects(exportReviewedDataset(fixture), /image hash .* leaks across splits/);
  });
  await t.test('group across splits', async () => {
    const fixture = await datasetFixture({ second: true });
    const secondBytes = Uint8Array.from([...PNG_4_BY_3, 0x00]);
    const secondHash = sha256(secondBytes);
    const secondPath = path.join(path.dirname(fixture.manifestPath), 'images', `${secondHash}.png`);
    await writeFile(secondPath, secondBytes);
    fixture.observations[1].asset = { sha256: secondHash, mime: 'image/png', localPath: `images/${secondHash}.png` };
    await writeFile(fixture.manifestPath, JSON.stringify({ version: 1, observations: fixture.observations }));
    await writeFile(fixture.reviewsPath, JSON.stringify({
      version: 1,
      datasetVersion: 'pilot-v1',
      records: [fixture.review('observation-1'), fixture.review('observation-2', { split: 'validation' })],
    }));
    await assert.rejects(exportReviewedDataset(fixture), /group truck:unit-100 leaks across splits/);
  });
});
