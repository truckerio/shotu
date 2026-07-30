# Proofreading provider

Narrative workorder fields use one shared UI component and one authenticated
server contract:

```text
NarrativeField -> POST /api/proofreading/check -> WProofreader adapter
```

The browser never receives provider credentials or connects directly to the
vendor. Provider responses are normalized to `start`, `end`, `problem`,
`message`, and `suggestions`, so a future provider replacement does not require
changes across workorder forms.

The server sends the active narrative field text to WProofreader for analysis.
Identifiers, passwords, names, and search fields do not use this provider.

## Configuration

```dotenv
PROOFREADING_PROVIDER=wproofreader
WPROOFREADER_SERVICE_ID=
PROOFREADING_TIMEOUT_MS=3000
```

Store `WPROOFREADER_SERVICE_ID` only in local untracked environment files and
the deployment secret manager. WProofreader documents its HTTP API at
<https://webspellchecker.com/wsc-web-api/>.

If the provider is unavailable, narrative controls retain the browser or
device's native spellcheck. Provider errors never block creating or updating a
workorder.

## Adding or replacing a provider

1. Add an adapter under `src/server/modules/proofreading/providers/` with a
   stable `name` and `check({ language, text })` method.
2. Normalize its result to the existing issue contract.
3. Register it in `proofreading.service.js` using a new
   `PROOFREADING_PROVIDER` value.
4. Add provider contract tests and run the real shop-language benchmark before
   changing the deployment setting.

Do not import provider SDKs into individual forms. `NarrativeField` is the only
shared presentation owner, while the server module is the only provider owner.
