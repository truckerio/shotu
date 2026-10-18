# Parts AI: source inventory and continuous learning foundation

Research date: October 17, 2026. Scope: Freightliner-first mechanic camera identification inside an existing workorder. This is an initial source inventory and bounded candidate collection, not an exhaustive archive, a trained model, or an enabled production learner.

## What we should build

A mechanic opens the camera in a workorder. The system uses the unit/VIN and confirmed engine/transmission configuration to narrow the search, detects visible component families, tracks their labels as the camera moves, and lets the mechanic tap a label. The detail sheet shows the supporting catalog diagram and candidate part, then creates an office request after confirmation. Exact SKU and fitment come from a licensed catalog or verified part markings, not visual similarity alone.

We need three different kinds of evidence:

1. Photographs with reviewed boxes/masks teach visual recognition.
2. OEM/supplier catalog records establish assemblies, callouts, part numbers, supersessions and applicability.
3. Confirmed shop examples connect real camera views to catalog entries and installed configurations.

A diagram is not an installed engine-bay photograph. A model/year is not an exact build configuration. Repair history can change what is installed. Telematics can provide diagnostic context but does not prove which visually similar replacement fits.

## Source inventory

The executable registry is `scripts/parts-ai-data/sources.json`. Its `candidate` status means suitable for investigation, never approved for training. Reference entries are recorded as links only; the collector does not crawl those websites or download their catalogs.

| Source | Material and coverage | Access and current disposition |
| --- | --- | --- |
| [DTNA PartsProX / Excelerator](https://www.dtnaparts.com/excelerator/) | OEM VIN/serial-related catalog and purchasing tools | Existing dealer access is useful. API, embedding, diagram/image export and AI training permission remain unverified. Login is not a bulk-data license. |
| [DTNA customer access](https://dtnacontent-dtna.prd.freightliner.com/content/public/DTNAConnect-NewUser.html) | Customer registration and administrator route | Use existing customer/dealer relationship to request the correct integration/licensing contact. No account creation or contact sent in this work. |
| [Freightliner manuals](https://www.freightliner.com/parts/driver-maintenance-manuals/) / [DTNA public literature](https://www.dtnatechlit.com/portal-public?make=freightliner) | Driver and maintenance documents | Useful references, not a complete parts BOM. Document reuse/training rights need checking. |
| [DTNA PartsCap](https://www.dtnaparts.com/parts-cap/) | Supplier parts information | Supporting reference. Bulk image/data rights unconfirmed. |
| [Automann catalog library](https://www.automann.com/resources/index/index/category/catalogs/) | Component/application PDFs, including engine references | Public links; supplier permission needed before ingestion for commercial training. |
| [Gabriel heavy-duty 2026 PDF](https://www.automann.com/media/pdf/files/gabriel-heavy-duty-catalog-2026.pdf) | 389-page shock/application reference including several Freightliner families | Inspected as a reference, not ingested. Applications are not the entire vehicle catalog. |
| [Dorman M2 sheet](https://static.dormanproducts.com/document/web/Freightliner-M2_Make-Sheet_HD.pdf) / [catalog library](https://www.dormanproducts.com/pages/resources/catalogs/dorman.aspx) | Selected M2 106/112 replacement parts | Sheet is old and explicitly requires written approval for reproduction. No training ingestion. |
| [United Pacific catalogs](https://truck.upauto.com/product-catalogs) | Freightliner accessories, interior and collision categories | Freightliner PDF links tested returned 404. No catalog archive collected or training permission established. |
| [Cummins parts information](https://www.cummins.com/en-na/parts/parts-information) | Engine serial-specific lookup route | Confirm installed engine and obtain licensed access. Freightliner chassis VIN alone is insufficient. |
| [Commons alternators](https://commons.wikimedia.org/wiki/Category:Automobile_alternators) and [diesel parts](https://commons.wikimedia.org/wiki/Category:Diesel_engine_parts) | General component photos with per-file metadata | Bounded collection implemented. Mixed vehicles, marine/stationary engines and irrelevant category results require visual review. No VIN labels. |
| [Commons Cascadia](https://commons.wikimedia.org/wiki/Category:Freightliner_Cascadia) | Truck exterior pictures | Discovery reference only in the initial registry. Useful for exterior context, not exact component identification. |
| [Engine Parts dataset](https://universe.roboflow.com/engineparts/engine-parts-c2xfb) | Page reports 383 images and five internal-engine classes | Uploader declares CC BY 4.0. Original provenance and annotation quality need verification. No archive downloaded. Not installed Freightliner engine-bay coverage. |
| [Carparts-Seg](https://docs.ultralytics.com/datasets/segment/carparts-seg/) | Documentation reports 3,833 images / 23 exterior car classes | Potential segmentation baseline. Not truck engine-bay data. No archive imported. |
| [Car-seg upstream](https://universe.roboflow.com/gianmarco-russo-vt9xr/car-seg-un1pm) | Current page reports 2,255 images / 21 classes, CC BY 4.0 | Counts/classes differ from downstream Carparts-Seg. Resolve version mapping and original image ownership before combining. Documentation/framework licensing must not be mistaken for asset licensing. |
| [JHU CGPart](https://archive.data.jhu.edu/dataset.xhtml?persistentId=doi%3A10.7281%2FT1%2FYZKNJ6&version=1.1) | Synthetic vehicle parts and real evaluation images | CC BY-NC 4.0. Excluded from this commercial pipeline unless separately licensed. |
| [LSCP paper](https://arxiv.org/abs/2311.11754) | Paper describes 84,162 car-part images / 12 types | Archive, original image rights and exact applicability not verified. Paper availability is not image permission. Reference only. |
| [Engine-bay-parts](https://universe.roboflow.com/stephens-workspace-gjyrj/engine-bay-parts) | Page reports 2,378 images and 52 classes, uploader-declared MIT | More relevant mounted-component candidate, but numbered/unclear classes, original asset rights and label quality need audit. No archive imported; no verified Freightliner coverage. |
| [Truck Wheel Rim Line](https://huggingface.co/datasets/frmc/Truck-Wheel-Rim-Line-Dataset) | Uploader-declared CC BY 4.0; wheel/rim/chassis annotation task | Narrow truck exterior task, not engine-part recognition. Image/annotation pairing and original provenance not audited; no archive imported. |
| Our shop capture | Real installed parts, dirty/occluded views, mechanic corrections, confirmed purchase/installation outcomes | Highest relevance, but not collected in this task. Need company authorization, employee/customer privacy rules and separate training consent; owning a photo does not grant ownership of a visible third-party catalog diagram. |

There is no verified public download here containing every Freightliner model's complete VIN-specific diagrams, parts, images and training rights. Do not promise coverage beyond an audited asset list. Start with the actual fleet's Cascadia configurations, then M2 and vocational models after coverage is measured.

## How to obtain the missing catalog rights

Ask the current Freightliner dealer to route a request to DTNA's catalog/data integration and licensing team. Request a sample for company-owned VINs before paying for or building an integration. The request should specify:

- VIN/build configuration and assembly BOM access; engine/transmission serial handling; supersessions and applicability dates.
- Diagram files plus callout coordinates and their part-number links; image resolution and update/version identifiers.
- A documented API, licensed feed/export, or supported embedded catalog. Ask which is actually available; do not assume a public PartsProX API exists.
- Rights to display content to mechanics inside our application, store/cache it, share it with the office, and associate company photos with catalog entries.
- Separate rights for model training, evaluation, derived annotations/embeddings, and use of trained weights after agreement termination.
- Tenant/fleet limits, rate limits, attribution, costs, refresh cadence, deletion and rights-withdrawal obligations.

Make equivalent requests to component suppliers for their product photography and part/application feeds. An OEM catalog may not include rights to republish every supplier image. Do not scrape logged-in portals or reuse shared dealer credentials as a data feed.

## Implemented collection and dataset gates

New standalone Node tools live in `scripts/parts-ai-data/`; see its README for exact commands and review schema. They do not change app runtime, database, mechanic UI or any model endpoint.

The collector uses a fixed Wikimedia Commons metadata API and separate hard limits of 20 metadata API attempts and 20 attempted search results per run. Downloads are opt-in, image-host restricted, bounded by time and bytes, checked against image signatures/content type, and content-hashed. Source pages, original image URLs, creator/license metadata and retrieval timestamps are retained. Changed rights evidence is kept as a new license observation instead of overwriting the prior evidence. An explicit source exclusion/removal makes its retained assets ineligible for export; a search miss alone is not proof of withdrawal. Content takedowns still need an explicit review/revocation process. References are not fetched as assets. Re-running updates discovery metadata without replacing stored human review fields.

The initial policy accepts explicitly declared CC0, public-domain or CC BY candidates for download. Unknown licenses, NC, ND and SA variants are withheld. This is a conservative initial product policy, not a statement that all SA material is unusable. Commons says reusers must check individual file licenses and attribution; metadata being reusable does not make each image unrestricted. [Commons reuse guidance](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia).

Downloaded candidates cannot become a training dataset by collection alone. Export requires explicit reviewer identity/date, a positive training and license decision with evidence, actual image dimensions, reviewed boxes and visual categories, and a truck/session group with an explicit split. Export checks source eligibility, file hashes, the license evidence hash and latest rights-observation event approved by the reviewer, and cross-split exact-image/group leakage. A rights-evidence transition requires a new approval tied to its latest observation event, including when a source changes back to an earlier license. Unchanged metadata refreshes do not create a new rights event. It does not infer SKU or fitment from category labels. Human approval is an explicit input contract; the local CLI is not an authenticated approval service. Keep the review files access-controlled.

Before training, also run decoded-image safety checks, perceptual near-duplicate/video-frame grouping, annotation completeness review and source-ownership audit. The starter export detects exact hashes and declared group collisions; it cannot independently discover every visually related frame or enforce an honest group identity. Keep such limitations visible.

## Continuous learning architecture

`Approved source registry -> scheduled bounded discovery -> candidate store -> rights and quality review -> mechanic annotations -> immutable dataset version -> candidate training -> locked evaluation -> explicit promotion -> monitored inference -> rollback`

1. **Discover:** Run the collector on approved queries. Track successful/failed fetches and drift in source/license metadata. Retain the original license evidence; do not silently reinterpret a changed license. Add new hosts/providers only after a source review. This task supplies a repeatable CLI, not a running scheduler.
2. **Triage:** Reject irrelevant photos, duplicate scenes, corrupted images, privacy issues and uncertain rights. Quarantine third-party content found inside images/documents. Treat all fetched text as untrusted data; it cannot issue tool instructions, add hosts, change policy or run code.
3. **Annotate:** Build a small taxonomy of visible installed component families with mechanics. Draw boxes/masks, include adjacent confusing objects and negative views, record occlusion and viewpoint. Category hints and AI guesses are suggestions only; neither is ground truth. Confirmed catalog links belong in a separately verified fitment layer.
4. **Version:** Freeze source asset hashes, annotations, taxonomy, attribution and reviewer decisions. Assign the entire truck/session to one split; keep near duplicates and frames from the same scene together. Maintain a locked fleet holdout that never enters training or automatic label correction.
5. **Train a candidate:** Add a separate approved training adapter after the first reviewed dataset exists. Pin architecture, pretrained-weight license, dependencies, seed and dataset hash; record compute/time/cost. This foundation does not launch GPU jobs or update any weights.
6. **Evaluate:** Compare with the currently approved model per class, truck/configuration, lighting, dirt, occlusion and device. Measure detection precision/recall, calibration/abstention, false confident labels, tracking stability and end-to-end latency. Separately evaluate catalog match/fitment. Set acceptance thresholds before inspecting the holdout; model-wide average accuracy alone cannot pass.
7. **Promote:** A designated reviewer approves a model version only after data/rights and regression gates pass. Keep prior weights, config and class map for rollback. Start with internal shadow mode and a small mechanic pilot; identification remains confirmable. No unattended web-to-production training loop.
8. **Improve:** Mechanic corrections and confirmed purchase/installation outcomes enter a new review queue. Do not recycle the AI's own predictions as verified labels. Monitor low-confidence/unknown views and wrong-label complaints. Re-evaluate rights withdrawals, source takedowns and affected dataset/model versions, and retrain/retire versions where required.

The knowledge/catalog index can refresh independently of detector retraining. Updating a superseded part number should not require teaching a camera detector a new shape.

## First useful Freightliner dataset

Select a limited number of common, visibly distinguishable component families with the shop, for example alternator, turbocharger, air compressor, air dryer, starter and accessible filters. These are candidate classes, not a claim all can be identified reliably from every angle. Start with a few known truck/engine configurations and a reviewed photo-capture protocol. Include real mounted views, removed-part views, labels/markings, nearby lookalikes and deliberate unknown examples.

Do not set a universal image count and call it enough. Capture an initial batch, measure per-class held-out performance, and collect additional examples where errors cluster. Record the exact configuration and installed changes when known. Minimize personal data: use opaque truck/session IDs in training exports, not customer names or unrestricted workorder text. Strip location/EXIF from derived training copies while preserving original evidence privately.

No removal, torque, isolation or replacement instruction should be generated as established fact from these photos. Future repair guidance needs licensed service procedures tied to exact configuration, revision and mechanic confirmation, with its own evaluation.

## Delivery evidence

Live run counts, failures, repeated-run behavior and focused test/review results are recorded below after collection. Model training, live tracking, catalog API integration, production learning and full fleet coverage remain separate implementation stages.

Initial live evidence (local research only):

- Initial registry: 20 sources, comprising two Commons searches and 18 link-only references. The final inventory adds two dataset references above: 22 sources total, with the same two bounded Commons searches.
- Metadata collection: 20 Commons image observations and 18 references, 38 total. Two consecutive metadata runs finished without failures and retained the same 38 observations.
- First opt-in download attempt saved two distinct images: an alternator cutaway illustration and an engine-bay photo with substantial occlusion. Three other requests returned HTTP 429; they were not bypassed. Following metadata checks, a bounded download run with the improved rate-limit handling saved two more images, stopped further downloads on its first HTTP 429, and retained all 20 image metadata records. Four distinct image files are saved in total; the remaining candidates were not downloaded.
- All four saved images were visually inspected by AI for triage, not approved by a human. The two later images show industrial/marine machinery with no established Freightliner relevance and are excluded from the initial pilot in the triage record. Zero training-approved images; no real training dataset exported and no model trained.
- Attempting to export the live manifest with an empty review file exited 1 with a missing-review error, as required.
- Local corpus and AI triage are at `/Users/karanpreetsingh/.codex/orchestrator/tasks/workorder-generator-c09a41b3/active/parts-ai-data-foundation/`. Do not publish the raw corpus as part of the application bundle. Attribute each file if it is later approved and reused.

Next: obtain a small licensed Freightliner catalog sample, collect authorized mounted-component photos from the actual fleet, and have mechanics validate the first boxes/classes and configuration links. This is the data needed to move from a public-data foundation to a useful Freightliner detector.

## Hugging Face prebuilt data and models

Follow-up research: October 17, 2026. Public Hub API search, repository file inventories and model/dataset cards inspected without login, running repository code or downloading weights/full image collections. Detailed API snapshots are saved beside the local corpus in `huggingface-search.json`, `huggingface-extra-search.json`, `huggingface-shortlist.json` and `huggingface-cards.json`. Hub search is not exhaustive; absence in these queries is not proof no suitable private or differently named repository exists.

| Repository | Verified inventory / declared license | Use and decision |
| --- | --- | --- |
| [DrBimmer/car-parts-and-damage-dataset](https://huggingface.co/datasets/DrBimmer/car-parts-and-damage-dataset) | Card: 1,812 images, 24,851 polygons, MIT. File inventory: 1,812 `/img/` images, 1,812 annotation JSONs, plus human/machine masks. | Best candidate here for an exterior-parts segmentation prototype. Card divides 998 parts / 814 damage images, but repository folder names appear reversed relative to these counts; inspect annotation classes rather than trusting folder names. Original ownership still needs audit. Dataset viewer currently errors; files exist. Full collection not downloaded. |
| [mitbersh/car-parts-segmentation-yolo](https://huggingface.co/datasets/mitbersh/car-parts-segmentation-yolo) | File inventory: 797 train + 102 val + 99 test images, 998 image files in split folders; YAML defines 33 exterior classes. No explicit license in inspected Hub card. | Convenient existing YOLO layout, but no rights approval. Viewer rows are annotation text and must not be counted as distinct images. May overlap other datasets; do not add counts without hash checks. |
| [frmc/Truck-Wheel-Rim-Line-Dataset](https://huggingface.co/datasets/frmc/Truck-Wheel-Rim-Line-Dataset) | Card: 353 distinct truck scenes, CC BY 4.0. File inventory: 353 image/label pairs in each of Pose and Segmentation. | Relevant narrow truck dataset. The same scenes occur in both directories, not 706 independent examples. Axle centers, rims and chassis lines, not underhood parts. No predefined evaluation split; the card's suggestion to share train and val directories must not be used for valid model evaluation. |
| [aegean-ai/engine-anomaly-detection-dataset](https://huggingface.co/datasets/aegean-ai/engine-anomaly-detection-dataset) | Three `.tar.gz` files, card points to an NTT custom license. | Engine anomaly task, not verified image-based component boxes. Inspect archive contents and license before deciding relevance; not imported. |
| [rarayayan/Detectron2-Zoo-Car-Parts-Detection](https://huggingface.co/rarayayan/Detectron2-Zoo-Car-Parts-Detection) | Downloadable `model_final.pth`, metrics and checkpoint marker. Card declares Apache 2.0 and links QADDER. | A pretrained model candidate, not a dataset. Sparse card; architecture/config/class mapping and training-data rights need audit before running. No verified Freightliner performance. No weights downloaded/executed. |
| [konst22/yolo11n-carparts-seg](https://huggingface.co/konst22/yolo11n-carparts-seg) | `best.pt`, class YAML and config exist; card has no meaningful description or explicit license. | A small segmentation-model candidate only. License/provenance and performance unverified. Do not automatically deploy. |
| [lidiashishina/car-parts-segmentation-tck28](https://huggingface.co/datasets/lidiashishina/car-parts-segmentation-tck28) | Apache 2.0 tag but only `.gitattributes` and README in file inventory. | Empty of image/annotation data; exclude from useful dataset totals. |
| [keywordbarrage/automotive-parts-catalog-intelligence](https://huggingface.co/datasets/keywordbarrage/automotive-parts-catalog-intelligence) | Only README and `.gitattributes`; no actual parts records/images. | An advertisement for data services, not a prebuilt catalog dataset. Excluded. |

The inspected Hub searches for `engine-parts`, `engine_parts`, `engine-bay`, `alternator` and Freightliner datasets did not identify a verified, usable Freightliner underhood component dataset. Broad `engine`/`truck` results include unrelated engineering text, road-scene detection, simulation and model-generated detection logs. Those logs are predictions, not human-verified labels.

Recommendation: audit the DrBimmer exterior dataset and the truck-rim subset first for a small experimental baseline. Keep the detector's visual class separate from catalog part-number lookup. For the actual engine-bay experience, supplement a suitable pretrained vision backbone with licensed/authorized mounted-component photos and reviewed Freightliner catalog links. Prebuilt data saves annotation work; it does not supply exact VIN fitment or prove truck performance.
