# Parts Helper

Server-owned part identification and live pricing support.

Supported vehicles:

- Volvo trucks
- Peterbilt trucks
- Freightliner Cascadia

Flow:

1. Search company-approved `parts_catalog` data by normalized part number, exact description, or approved alias.
2. Return company data immediately when a strong match exists.
3. Preserve an unknown part number exactly as the mechanic entered it and send it to office review without blocking chat.
4. For deliberate office lookup only, validate the truck family, enrich vehicle context, and use OpenAI web search as a suggestion.
5. Never allow AI to silently replace an exact part number entered by a user.
6. For pricing, run a fresh search every request and compare only source-backed listings. Nothing is stored as current market price.

An office-approved part is written back to the company catalog with the original request phrase as an alias. Future requests therefore resolve from company memory instead of AI.

Real-fleet acceptance testing:

- `npm run test:parts-helper:acceptance` selects representative supported trucks from the Samsara-backed `assets` table.
- It uses VIN-decoded engine data when NHTSA returns it; otherwise the printed result clearly labels engine context as a scenario assumption.
- It exercises identification, editable repair-order generation, fitment gating, and transient live pricing across 15 component scenarios.
- The runner masks VINs in terminal output and does not persist price comparisons or modify fleet/workorder data.

Authenticated routes:

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
