# Experimental Parts Helper

Isolated prototype. No database writes. No mechanic UI dependency.

Supported vehicles:

- Volvo trucks
- Peterbilt trucks
- Freightliner Cascadia

Flow:

1. Validate supported truck family.
2. Enrich vehicle and engine context from `partsnow/us-heavy-duty-trucks` through Hugging Face Dataset Viewer API.
3. Use OpenAI Responses API with required live `web_search` and strict structured output.
4. Return sourced part identity, fitment status, and editable repair instruction.
5. For pricing, run a fresh search every request and compare only source-backed listings. Nothing is stored as current market price.

Real-fleet acceptance testing:

- `npm run test:parts-helper:acceptance` selects representative supported trucks from the Samsara-backed `assets` table.
- It uses VIN-decoded engine data when NHTSA returns it; otherwise the printed result clearly labels engine context as a scenario assumption.
- It exercises identification, editable repair-order generation, fitment gating, and transient live pricing across 15 component scenarios.
- The runner masks VINs in terminal output and does not persist price comparisons or modify fleet/workorder data.

Routes are disabled unless `PARTS_HELPER_ENABLED=true`:

- `GET /api/parts-helper/status`
- `POST /api/parts-helper/identify`
- `POST /api/parts-helper/live-prices`
- `POST /api/parts-helper/office-request` accepts mechanic chat text plus optional supported image URL/data URL, identifies part, then searches fresh prices only after exact match.

Office photo formats: PNG, JPEG, WebP, or non-animated GIF. Convert phone HEIC uploads to JPEG before calling OpenAI.

Required for live OpenAI tests:

- `OPENAI_API_KEY`

Optional:

- `PARTS_HELPER_OPENAI_MODEL`
- `PARTS_HELPER_HF_DATASET`
- `HF_TOKEN` for gated datasets

Removal:

1. Delete this folder.
2. Remove `handlePartsHelperApi` import and handler call from `server.js`.
3. Remove parts-helper environment entries and npm scripts.
