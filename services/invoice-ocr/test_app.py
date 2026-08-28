from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from PIL import Image

import app


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


if __name__ == "__main__":
    unittest.main()
