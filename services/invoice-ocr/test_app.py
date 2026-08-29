from __future__ import annotations

import asyncio
import os
import tempfile
import time
import types
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image

_original_service_token = os.environ.get("OCR_SERVICE_TOKEN")
os.environ["OCR_SERVICE_TOKEN"] = "test-token"

import app

if _original_service_token is None:
    os.environ.pop("OCR_SERVICE_TOKEN", None)
else:
    os.environ["OCR_SERVICE_TOKEN"] = _original_service_token


class InvoiceOcrPreprocessingTests(unittest.TestCase):
    def test_large_image_is_downscaled_without_changing_aspect_ratio(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.png"
            output = Path(directory) / "prepared.jpg"
            Image.new("RGB", (2160, 3840), "white").save(source)

            width, height = app._prepare_image(str(source), str(output))

            self.assertEqual(max(width, height), app.IMAGE_MAX_SIDE)
            self.assertAlmostEqual(width / height, 2160 / 3840, places=3)
            with Image.open(output) as prepared:
                self.assertEqual(prepared.mode, "RGB")
                self.assertEqual(prepared.size, (width, height))

    def test_small_image_is_not_upscaled(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.png"
            output = Path(directory) / "prepared.jpg"
            Image.new("RGBA", (800, 600), (255, 255, 255, 0)).save(source)

            self.assertEqual(app._prepare_image(str(source), str(output)), (800, 600))


class FakeStreamingRequest:
    def __init__(
        self,
        chunks: list[bytes],
        content_type: str,
        content_length: str | None = None,
        token: str | None = "test-token",
        client_host: str | None = "127.0.0.1",
    ) -> None:
        self.headers = {"content-type": content_type}
        if content_length is not None:
            self.headers["content-length"] = content_length
        if token is not None:
            self.headers["x-ocr-token"] = token
        self.client = types.SimpleNamespace(host=client_host) if client_host is not None else None
        self.chunks = chunks

    async def stream(self):
        for chunk in self.chunks:
            yield chunk


class SlowStreamingRequest(FakeStreamingRequest):
    async def stream(self):
        await asyncio.sleep(1)
        yield self.chunks[0]


class InvoiceOcrRequestGateTests(unittest.IsolatedAsyncioTestCase):
    async def test_streaming_limit_rejects_actual_bytes_without_calling_request_body(self) -> None:
        request = FakeStreamingRequest([b"\x89PNG\r\n\x1a\n", b"x" * 20], "image/png")
        with mock.patch.object(app, "MAX_DOCUMENT_BYTES", 16):
            with self.assertRaises(app.HTTPException) as caught:
                await app._stream_document(request)
        self.assertEqual(caught.exception.status_code, 413)

    async def test_magic_must_match_declared_content_type(self) -> None:
        request = FakeStreamingRequest([b"\xff\xd8\xff", b"payload"], "image/png")
        with self.assertRaises(app.HTTPException) as caught:
            await app._stream_document(request)
        self.assertEqual(caught.exception.status_code, 415)

    async def test_streamed_document_returns_verified_type_and_temp_file(self) -> None:
        request = FakeStreamingRequest([b"\x89PNG\r\n\x1a\n", b"payload"], "image/png")
        path, content_type = await app._stream_document(request)
        try:
            self.assertEqual(content_type, "image/png")
            self.assertEqual(path.read_bytes(), b"\x89PNG\r\n\x1a\npayload")
        finally:
            path.unlink(missing_ok=True)

    async def test_invalid_content_length_is_safe_client_error(self) -> None:
        request = FakeStreamingRequest([b"\x89PNG\r\n\x1a\n"], "image/png", "not-an-integer")
        with self.assertRaises(app.HTTPException) as caught:
            await app._stream_document(request)
        self.assertEqual(caught.exception.status_code, 400)

    async def test_slow_upload_is_time_bounded(self) -> None:
        request = SlowStreamingRequest([b"\x89PNG\r\n\x1a\n"], "image/png")
        with mock.patch.object(app, "UPLOAD_TIMEOUT_SECONDS", 0.01):
            with self.assertRaises(app.HTTPException) as caught:
                await app._extract(request, "ocr")
        self.assertEqual(caught.exception.status_code, 408)

    async def test_missing_or_wrong_token_is_hidden_before_body_processing(self) -> None:
        for token in (None, "wrong"):
            with self.subTest(token=token):
                request = FakeStreamingRequest([b"not-read"], "image/png", token=token)
                with self.assertRaises(app.HTTPException) as caught:
                    await app._extract(request, "ocr")
                self.assertEqual(caught.exception.status_code, 404)
                self.assertEqual(caught.exception.detail, "Not found")


class InvoiceOcrAuthenticationTests(unittest.TestCase):
    def test_default_tokenless_configuration_fails_closed(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "OCR_SERVICE_TOKEN is required"):
            app._validate_auth_configuration("", False, "production", "0.0.0.0")

    def test_tokenless_development_requires_development_mode_and_loopback_bind(self) -> None:
        invalid = [
            ("production", "127.0.0.1"),
            ("development", "0.0.0.0"),
            ("development", "localhost"),
        ]
        for mode, bind_host in invalid:
            with self.subTest(mode=mode, bind_host=bind_host):
                with self.assertRaisesRegex(RuntimeError, "Tokenless OCR requires"):
                    app._validate_auth_configuration("", True, mode, bind_host)
        self.assertTrue(app._validate_auth_configuration("", True, "development", "127.0.0.1"))
        self.assertTrue(app._validate_auth_configuration("", True, "development", "::1"))

    def test_configured_token_is_always_required(self) -> None:
        good = FakeStreamingRequest([], "image/png", token="expected", client_host="203.0.113.10")
        missing = FakeStreamingRequest([], "image/png", token=None)
        wrong = FakeStreamingRequest([], "image/png", token="wrong")
        with mock.patch.object(app, "SERVICE_TOKEN", "expected"), mock.patch.object(app, "TOKENLESS_DEVELOPMENT", True):
            self.assertTrue(app._authorized(good))
            self.assertFalse(app._authorized(missing))
            self.assertFalse(app._authorized(wrong))

    def test_tokenless_development_accepts_only_loopback_peer(self) -> None:
        loopback = FakeStreamingRequest([], "image/png", token=None, client_host="127.0.0.1")
        ipv6_loopback = FakeStreamingRequest([], "image/png", token=None, client_host="::1")
        remote = FakeStreamingRequest([], "image/png", token=None, client_host="192.0.2.10")
        unknown = FakeStreamingRequest([], "image/png", token=None, client_host=None)
        with mock.patch.object(app, "SERVICE_TOKEN", ""), mock.patch.object(app, "TOKENLESS_DEVELOPMENT", True):
            self.assertTrue(app._authorized(loopback))
            self.assertTrue(app._authorized(ipv6_loopback))
            self.assertFalse(app._authorized(remote))
            self.assertFalse(app._authorized(unknown))


class InvoiceOcrSubprocessTests(unittest.TestCase):
    def test_worker_timeout_terminates_process_group(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            worker = Path(directory) / "slow_worker.py"
            worker.write_text("import time\ntime.sleep(10)\n", encoding="utf-8")
            document = Path(directory) / "input.png"
            document.write_bytes(b"\x89PNG\r\n\x1a\n")
            with (
                mock.patch.object(app, "WORKER_PATH", worker),
                mock.patch.object(app, "WORKER_TIMEOUT_SECONDS", 0.05),
            ):
                with self.assertRaises(app.WorkerFailure) as caught:
                    app._run_worker(document, "image/png", "ocr")
            self.assertEqual(caught.exception.code, "ocr_timeout")


class InvoiceOcrCancellationTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancellation_waits_for_worker_cleanup(self) -> None:
        def slow_worker(*_args):
            time.sleep(0.05)
            return {"ok": True}

        with tempfile.TemporaryDirectory() as directory:
            started = time.perf_counter()
            with mock.patch.object(app, "_run_worker", slow_worker):
                task = asyncio.create_task(
                    app._run_worker_cancellation_safe(Path(directory) / "input.png", "image/png", "ocr")
                )
                await asyncio.sleep(0.01)
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task
            self.assertGreaterEqual(time.perf_counter() - started, 0.045)


if __name__ == "__main__":
    unittest.main()
