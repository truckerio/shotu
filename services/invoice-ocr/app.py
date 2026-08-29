from __future__ import annotations

import asyncio
import hmac
import importlib.metadata
import ipaddress
import json
import os
import signal
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse


def _bounded_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return min(maximum, max(minimum, value))


def _environment_flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def _is_loopback_host(host: str) -> bool:
    try:
        return ipaddress.ip_address(host.strip().strip("[]")).is_loopback
    except ValueError:
        return False


def _validate_auth_configuration(
    service_token: str,
    allow_tokenless_development: bool,
    runtime_mode: str,
    bind_host: str,
) -> bool:
    if service_token:
        return False
    if not allow_tokenless_development:
        raise RuntimeError("OCR_SERVICE_TOKEN is required")
    if runtime_mode != "development" or not _is_loopback_host(bind_host):
        raise RuntimeError(
            "Tokenless OCR requires OCR_RUNTIME_MODE=development and a loopback OCR_BIND_HOST"
        )
    return True


MAX_DOCUMENT_BYTES = _bounded_int("OCR_MAX_DOCUMENT_BYTES", 10 * 1024 * 1024, 1, 20 * 1024 * 1024)
MAX_PAGES = _bounded_int("OCR_MAX_PAGES", 3, 1, 10)
MAX_REGIONS = _bounded_int("OCR_MAX_REGIONS", 5000, 100, 10_000)
IMAGE_MAX_SIDE = _bounded_int("OCR_IMAGE_MAX_SIDE", 2200, 1200, 4096)
MAX_IMAGE_PIXELS = _bounded_int("OCR_MAX_IMAGE_PIXELS", 20_000_000, 1_000_000, 50_000_000)
MAX_NATIVE_TEXT_CHARS = _bounded_int("OCR_MAX_NATIVE_TEXT_CHARS", 100_000, 10_000, 500_000)
MAX_IN_FLIGHT_REQUESTS = _bounded_int("OCR_MAX_IN_FLIGHT_REQUESTS", 2, 1, 4)
UPLOAD_TIMEOUT_SECONDS = _bounded_int("OCR_UPLOAD_TIMEOUT_SECONDS", 30, 5, 120)
WORKER_TIMEOUT_SECONDS = _bounded_int("OCR_WORKER_TIMEOUT_SECONDS", 110, 5, 300)
NATIVE_TIMEOUT_SECONDS = _bounded_int("OCR_NATIVE_TIMEOUT_SECONDS", 8, 1, 30)
WORKER_CPU_SECONDS = _bounded_int("OCR_WORKER_CPU_SECONDS", 90, 2, 240)
WORKER_MEMORY_BYTES = _bounded_int("OCR_WORKER_MEMORY_BYTES", 3 * 1024**3, 512 * 1024**2, 4 * 1024**3)
WORKER_FILE_BYTES = _bounded_int("OCR_WORKER_FILE_BYTES", 128 * 1024**2, 16 * 1024**2, 256 * 1024**2)
MAX_WORKER_OUTPUT_BYTES = _bounded_int("OCR_MAX_WORKER_OUTPUT_BYTES", 12 * 1024**2, 1024**2, 20 * 1024**2)
SERVICE_TOKEN = os.getenv("OCR_SERVICE_TOKEN", "").strip()
RUNTIME_MODE = os.getenv("OCR_RUNTIME_MODE", "production").strip().lower()
BIND_HOST = os.getenv("OCR_BIND_HOST", "").strip()
ALLOW_TOKENLESS_DEVELOPMENT = _environment_flag("OCR_ALLOW_TOKENLESS_DEVELOPMENT")
TOKENLESS_DEVELOPMENT = _validate_auth_configuration(
    SERVICE_TOKEN,
    ALLOW_TOKENLESS_DEVELOPMENT,
    RUNTIME_MODE,
    BIND_HOST,
)
ALLOWED_TYPES = {"image/png", "image/jpeg", "image/webp", "application/pdf"}
WORKER_PATH = Path(__file__).with_name("parser_worker.py")

app = FastAPI(title="Workorder Invoice OCR", docs_url=None, redoc_url=None, openapi_url=None)
_inference_lock = asyncio.Lock()
_request_slots = asyncio.Semaphore(MAX_IN_FLIGHT_REQUESTS)


class WorkerFailure(Exception):
    def __init__(self, code: str, message: str, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def _package_version(name: str) -> str:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return "unavailable"


def _authorized(request: Request) -> bool:
    supplied = request.headers.get("x-ocr-token", "")
    if SERVICE_TOKEN:
        return hmac.compare_digest(supplied, SERVICE_TOKEN)
    if not TOKENLESS_DEVELOPMENT or request.client is None:
        return False
    return _is_loopback_host(request.client.host)


def _declared_content_type(request: Request) -> str:
    return request.headers.get("content-type", "").split(";", 1)[0].strip().lower()


def _declared_length(request: Request) -> int | None:
    raw = request.headers.get("content-length")
    if raw is None:
        return None
    try:
        length = int(raw)
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Invalid content length") from error
    if length < 0:
        raise HTTPException(status_code=400, detail="Invalid content length")
    return length


def _detect_document_type(header: bytes) -> str | None:
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if header.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(header) >= 12 and header.startswith(b"RIFF") and header[8:12] == b"WEBP":
        return "image/webp"
    pdf_offset = header.find(b"%PDF-")
    if 0 <= pdf_offset <= 1024 and not header[:pdf_offset].strip(b"\x00\t\n\x0c\r "):
        return "application/pdf"
    return None


async def _stream_document(request: Request) -> tuple[Path, str]:
    declared_type = _declared_content_type(request)
    if declared_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported document type")
    declared_length = _declared_length(request)
    if declared_length is not None and declared_length > MAX_DOCUMENT_BYTES:
        raise HTTPException(status_code=413, detail="Document too large")

    descriptor, raw_path = tempfile.mkstemp(prefix="ocr-upload-", suffix=".bin")
    path = Path(raw_path)
    total = 0
    header = bytearray()
    try:
        with os.fdopen(descriptor, "wb") as output:
            async for chunk in request.stream():
                if not chunk:
                    continue
                total += len(chunk)
                if total > MAX_DOCUMENT_BYTES:
                    raise HTTPException(status_code=413, detail="Document too large")
                if len(header) < 1036:
                    header.extend(chunk[: 1036 - len(header)])
                output.write(chunk)
        if total == 0:
            raise HTTPException(status_code=400, detail="Empty document")
        detected_type = _detect_document_type(bytes(header))
        if detected_type is None or detected_type != declared_type:
            raise HTTPException(status_code=415, detail="Document type does not match its content")
        return path, detected_type
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def _terminate_worker(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        process.kill()


def _run_worker(path: Path, content_type: str, operation: str) -> dict[str, Any]:
    timeout = NATIVE_TIMEOUT_SECONDS if operation == "native-text" else WORKER_TIMEOUT_SECONDS
    descriptor, raw_output_path = tempfile.mkstemp(prefix="ocr-result-", suffix=".json")
    os.close(descriptor)
    output_path = Path(raw_output_path)
    env = {
        key: value
        for key, value in os.environ.items()
        if key not in {"OCR_SERVICE_TOKEN", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"}
    }
    command = [sys.executable, str(WORKER_PATH), operation, str(path), str(output_path), content_type]
    process: subprocess.Popen[bytes] | None = None
    try:
        process = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=env,
            close_fds=True,
            start_new_session=True,
        )
        try:
            return_code = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired as error:
            _terminate_worker(process)
            process.wait()
            raise WorkerFailure("ocr_timeout", "OCR processing timed out.", 504) from error
        try:
            output_size = output_path.stat().st_size
        except FileNotFoundError as error:
            raise WorkerFailure("ocr_failed", "OCR could not process this document.", 422) from error
        if return_code != 0 or output_size <= 0 or output_size > MAX_WORKER_OUTPUT_BYTES:
            raise WorkerFailure("ocr_failed", "OCR could not process this document.", 422)
        try:
            envelope = json.loads(output_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise WorkerFailure("ocr_failed", "OCR could not process this document.", 422) from error
        if not isinstance(envelope, dict):
            raise WorkerFailure("ocr_failed", "OCR could not process this document.", 422)
        if envelope.get("ok") is True and isinstance(envelope.get("result"), dict):
            return envelope["result"]
        code = str(envelope.get("code") or "ocr_failed")
        status_by_code = {
            "document_too_large": 413,
            "image_too_large": 413,
            "too_many_pages": 413,
            "encrypted_pdf": 422,
            "active_pdf": 422,
            "malformed_document": 422,
            "unsupported_document": 415,
        }
        message_by_code = {
            "document_too_large": "Document too large.",
            "image_too_large": "Document image dimensions are too large.",
            "too_many_pages": "PDF has too many pages.",
            "encrypted_pdf": "Encrypted PDFs are not supported.",
            "active_pdf": "PDF contains unsupported active content.",
            "malformed_document": "Document is malformed.",
            "unsupported_document": "Unsupported document type.",
        }
        raise WorkerFailure(code, message_by_code.get(code, "OCR could not process this document."), status_by_code.get(code, 422))
    finally:
        if process is not None:
            _terminate_worker(process)
        output_path.unlink(missing_ok=True)


async def _run_worker_cancellation_safe(path: Path, content_type: str, operation: str) -> dict[str, Any]:
    worker_task = asyncio.create_task(asyncio.to_thread(_run_worker, path, content_type, operation))
    try:
        return await asyncio.shield(worker_task)
    except asyncio.CancelledError:
        # A disconnected caller must not orphan a resource-consuming worker or
        # release the inference slot while that worker is still alive.
        try:
            await worker_task
        except Exception:
            pass
        raise


def _prepare_image(path: str, output_path: str) -> tuple[int, int]:
    from parser_worker import prepare_image

    return prepare_image(path, output_path)


@app.exception_handler(Exception)
async def _safe_exception_handler(_request: Request, _error: Exception) -> JSONResponse:
    return JSONResponse(status_code=500, content={"error": {"code": "ocr_failed", "message": "OCR could not process this document."}})


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "provider": "paddleocr",
        "providerVersion": _package_version("paddleocr"),
        "maxDocumentBytes": MAX_DOCUMENT_BYTES,
        "maxPages": MAX_PAGES,
        "imageMaxSide": IMAGE_MAX_SIDE,
    }


async def _extract(request: Request, operation: str) -> dict[str, Any]:
    if not _authorized(request):
        raise HTTPException(status_code=404, detail="Not found")
    if operation == "native-text" and _declared_content_type(request) != "application/pdf":
        raise HTTPException(status_code=415, detail="Native text extraction requires a PDF")
    if _request_slots.locked():
        raise HTTPException(status_code=503, detail="OCR service is busy")
    await _request_slots.acquire()
    try:
        try:
            async with asyncio.timeout(UPLOAD_TIMEOUT_SECONDS):
                path, content_type = await _stream_document(request)
        except TimeoutError as error:
            raise HTTPException(status_code=408, detail="Document upload timed out") from error
        try:
            async with _inference_lock:
                try:
                    return await _run_worker_cancellation_safe(path, content_type, operation)
                except WorkerFailure as error:
                    raise HTTPException(status_code=error.status_code, detail=error.message) from error
        finally:
            path.unlink(missing_ok=True)
    finally:
        _request_slots.release()


@app.post("/v1/ocr")
async def extract_ocr(request: Request) -> dict[str, Any]:
    return await _extract(request, "ocr")


@app.post("/v1/native-text")
async def extract_native_text(request: Request) -> dict[str, Any]:
    return await _extract(request, "native-text")
