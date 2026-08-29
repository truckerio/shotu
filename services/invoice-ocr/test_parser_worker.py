from __future__ import annotations

import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image

import parser_worker


def rejection_code(function, *args):
    with unittest.TestCase().assertRaises(parser_worker.RejectedDocument) as caught:
        function(*args)
    return caught.exception.code


class ParserGateTests(unittest.TestCase):
    def test_rejects_malformed_encrypted_and_active_pdf_stubs(self) -> None:
        self.assertEqual(rejection_code(parser_worker._validate_pdf_bytes, b"not a pdf"), "malformed_document")
        self.assertEqual(
            rejection_code(parser_worker._validate_pdf_bytes, b"%PDF-1.7\n1 0 obj<</Encrypt 2 0 R>>\n%%EOF"),
            "encrypted_pdf",
        )
        self.assertEqual(
            rejection_code(parser_worker._validate_pdf_bytes, b"%PDF-1.7\n1 0 obj<</OpenAction 2 0 R>>\n%%EOF"),
            "active_pdf",
        )

    def test_accepts_minimal_inert_pdf_shape(self) -> None:
        parser_worker._validate_pdf_bytes(b"%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF")

    def test_rejects_image_pixel_budget_before_conversion(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.png"
            Image.new("RGB", (20, 20), "white").save(source)
            with mock.patch.object(parser_worker, "MAX_IMAGE_PIXELS", 100):
                self.assertEqual(rejection_code(parser_worker._inspect_image, str(source)), "image_too_large")

    def test_rejects_animated_webp(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "animated.webp"
            frames = [Image.new("RGB", (10, 10), color) for color in ("white", "black")]
            frames[0].save(source, format="WEBP", save_all=True, append_images=frames[1:], duration=10, loop=0)
            self.assertEqual(rejection_code(parser_worker._inspect_image, str(source)), "unsupported_document")

    def test_rejects_pdf_above_page_limit_instead_of_truncating(self) -> None:
        closed = []

        class FakePdf:
            def __init__(self, _path):
                pass

            def __len__(self):
                return parser_worker.MAX_PAGES + 1

            def close(self):
                closed.append(True)

        fake_pdfium = types.SimpleNamespace(PdfDocument=FakePdf)
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "many-pages.pdf"
            source.write_bytes(b"%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF")
            with mock.patch.dict(sys.modules, {"pypdfium2": fake_pdfium}):
                self.assertEqual(rejection_code(parser_worker._open_pdf, str(source)), "too_many_pages")
        self.assertEqual(closed, [True])

    def test_rejects_pdf_render_pixel_bomb_before_render(self) -> None:
        class FakePage:
            @staticmethod
            def get_size():
                return (100_000, 100_000)

        self.assertEqual(rejection_code(parser_worker._page_render_size, FakePage()), "image_too_large")

    def test_model_free_image_result_preserves_success_schema(self) -> None:
        class FakeModel:
            @staticmethod
            def ocr(_path, cls=True):
                self.assertTrue(cls)
                return [[[
                    [[0, 0], [10, 0], [10, 10], [0, 10]],
                    ("INV-1", 0.9),
                ]]]

        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "invoice.png"
            Image.new("RGB", (10, 10), "white").save(source)
            with mock.patch.object(parser_worker, "_get_model", return_value=FakeModel()):
                result = parser_worker.extract_document(str(source), "image/png")
        self.assertEqual(
            set(result),
            {"provider", "providerVersion", "confidence", "text", "pageCount", "regions", "durationMs"},
        )
        self.assertEqual(result["text"], "INV-1")
        self.assertEqual(result["pageCount"], 1)
        self.assertEqual(result["regions"][0]["pageNumber"], 1)


if __name__ == "__main__":
    unittest.main()
