# Invoice OCR service

The service requires `OCR_SERVICE_TOKEN` by default. Send the configured value
in the `x-ocr-token` request header. The Docker Compose configuration refuses to
start unless `OCR_SERVICE_TOKEN` is set:

```sh
OCR_SERVICE_TOKEN='replace-with-a-long-random-token' docker compose up --build
```

Tokenless operation is restricted to direct, loopback-only development. All of
these settings are required, and requests from non-loopback peers are still
rejected:

```sh
OCR_ALLOW_TOKENLESS_DEVELOPMENT=true \
OCR_RUNTIME_MODE=development \
OCR_BIND_HOST=127.0.0.1 \
uvicorn app:app --host 127.0.0.1 --port 8091 --workers 1 --no-access-log
```

Do not enable tokenless mode in a container, shared development host, preview,
staging, or production environment. If the token is absent without the exact
loopback development configuration, the application fails during startup.
