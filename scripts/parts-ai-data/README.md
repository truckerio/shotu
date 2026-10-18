# Parts AI data foundation tools

These dependency-free Node tools create a bounded, review-gated dataset foundation. They do not train a model, identify an exact SKU from an image, grant reuse rights, or promote a model to production.

## Collect candidate records

The source registry must use this shape:

```json
{
  "version": 1,
  "sources": [
    {
      "id": "commons-alternators",
      "kind": "commons_search",
      "url": "https://commons.wikimedia.org/",
      "query": "incategory:\"Automobile alternators\"",
      "limit": 5,
      "contentHosts": ["upload.wikimedia.org"],
      "trainingStatus": "candidate",
      "licenseEvidenceUrl": "https://commons.wikimedia.org/wiki/Commons:Licensing",
      "notes": "Category hint only; a reviewer must label each image."
    }
  ]
}
```

`kind` is `commons_search` or `reference`. `trainingStatus` is `candidate`, `permission_required`, or `excluded`. The registry URL is provenance only: Commons searches always use the pinned `https://commons.wikimedia.org/w/api.php` endpoint. A source defaults to five results, an explicit limit is capped at ten, and a run is capped at twenty results.

Collect metadata without image downloads:

```sh
node scripts/parts-ai-data/collect.mjs \
  --registry scripts/parts-ai-data/sources.json \
  --output-dir outputs/parts-ai-research/collected
```

Add `--download` to download eligible Commons images. Download eligibility requires all of these gates:

- the source is a `candidate` Commons search;
- explicit Commons metadata matches CC0, public domain, or CC BY;
- no NC, ND, SA, undeclared, or unknown license marker is present;
- every URL and redirect remains HTTPS on `upload.wikimedia.org` port 443 without user info;
- the response is at most 8 MiB and its declared type matches JPEG, PNG, or WebP magic bytes.

Downloading keeps the item a candidate. It never marks the image training-approved. Reference sources are recorded once and are never bulk-downloaded. Repeated collection deduplicates observations and content hashes, preserves the first retrieval time and any embedded human-review fields, and records the latest observation time and failures in `manifest.json`. CLI output contains only paths and counts.

The current registry is authoritative for eligibility. Removing a source, marking it `excluded`, or marking it `permission_required` makes prior observations inactive and revokes their download/training eligibility while retaining their evidence. A temporary search miss does not revoke an observation whose source remains a candidate. Commons metadata HTTP 429 pauses all later Commons metadata requests for that run; image HTTP 429 pauses later image downloads while retaining collected metadata.

Each observation stores the current `licenseObservationHash`, `licenseObservationEventId`, and an immutable `licenseObservations` history. The hash covers normalized rights evidence and collector policy fields, excluding timestamps and unrelated descriptive metadata. A changed license appends a uniquely numbered history event; an unchanged rerun leaves the current event stable. If rights change from A to B and later return to A, all three transitions remain in order and the newest A has a different event ID from the original A.

## Review records

Create a separate review file. One review is required for every downloaded observation, including rejected observations. Only records with `trainingApproved: true` are exported.

```json
{
  "version": 1,
  "datasetVersion": "parts-pilot-v1",
  "records": [
    {
      "observationId": "HASH_FROM_MANIFEST",
      "trainingApproved": true,
      "reviewedBy": "reviewer@example.com",
      "reviewedAt": "2026-10-17T20:00:00Z",
      "licenseApproval": {
        "approved": true,
        "evidenceUrl": "https://commons.wikimedia.org/wiki/File:Example.jpg",
        "observedLicenseHash": "64_HEX_CHARACTERS_FROM_THE_MANIFEST",
        "observedLicenseEventId": "LICENSE_EVENT_ID_FROM_THE_MANIFEST"
      },
      "category": "alternator",
      "imageWidth": 1600,
      "imageHeight": 1200,
      "boxes": [
        { "x": 100, "y": 80, "width": 900, "height": 700 }
      ],
      "groupKey": "truck:unit-42",
      "split": "train"
    }
  ]
}
```

`category` is a reviewer-observed visual class, not an exact part number. SKU, part-number, OEM-fitment, and fitment fields are rejected. `groupKey` must identify the truck or capture session so related images stay in one split. Each record needs an explicit `train`, `validation`, or `test` split. Bounding boxes and stated dimensions are checked against the actual file.

`observedLicenseHash` and `observedLicenseEventId` bind approval to the latest rights transition. If rights change and later return to the same terms, the hash may match an older review but the event ID will not, so the latest event still needs fresh approval before export.

## Export a reviewed dataset

```sh
node scripts/parts-ai-data/dataset.mjs \
  --manifest outputs/parts-ai-research/collected/manifest.json \
  --reviews outputs/parts-ai-research/reviews.json \
  --output-dir outputs/parts-ai-datasets
```

The exporter verifies each file hash and image dimensions, rejects missing reviews or rights evidence, and rejects hash or truck/session leakage across splits. It creates a new immutable `<output-dir>/<datasetVersion>/` directory containing copied hash-named images, `annotations.coco.json`, `provenance.json`, and `attribution.json`. It refuses to overwrite an existing dataset version.

Run the focused tests with:

```sh
node --test scripts/parts-ai-data/tools.test.mjs
```

This collection/export cycle supports deliberate dataset revisions. Continuous discovery can add candidates, but retraining remains a separate approved job, and model evaluation and production promotion remain separate human decisions.
