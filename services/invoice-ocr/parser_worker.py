from __future__ import annotations

import importlib.metadata
import json
import math
import os
import re
import sys
import tempfile
import time
import warnings
from pathlib import Path
from typing import Any


def _bounded_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return min(maximum, max(minimum, value))


MAX_PAGES = _bounded_int("OCR_MAX_PAGES", 3, 1, 10)
MAX_REGIONS = _bounded_int("OCR_MAX_REGIONS", 5000, 100, 10_000)
IMAGE_MAX_SIDE = _bounded_int("OCR_IMAGE_MAX_SIDE", 2200, 1200, 4096)
MAX_IMAGE_PIXELS = _bounded_int("OCR_MAX_IMAGE_PIXELS", 20_000_000, 1_000_000, 50_000_000)
MAX_NATIVE_TEXT_CHARS = _bounded_int("OCR_MAX_NATIVE_TEXT_CHARS", 100_000, 10_000, 500_000)
WORKER_CPU_SECONDS = _bounded_int("OCR_WORKER_CPU_SECONDS", 90, 2, 240)
WORKER_MEMORY_BYTES = _bounded_int("OCR_WORKER_MEMORY_BYTES", 3 * 1024**3, 512 * 1024**2, 4 * 1024**3)
WORKER_FILE_BYTES = _bounded_int("OCR_WORKER_FILE_BYTES", 128 * 1024**2, 16 * 1024**2, 256 * 1024**2)
PDF_RENDER_SCALE = min(3.0, max(1.0, float(os.getenv("OCR_PDF_RENDER_SCALE", "1.35"))))
ACTIVE_PDF_PATTERN = re.compile(
    rb"/(?:JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA|RichMedia|XFA|SubmitForm|ImportData)\b"
)


class RejectedDocument(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _apply_resource_limits() -> None:
    try:
        import resource

        resource.setrlimit(resource.RLIMIT_CPU, (WORKER_CPU_SECONDS, WORKER_CPU_SECONDS))
        resource.setrlimit(resource.RLIMIT_AS, (WORKER_MEMORY_BYTES, WORKER_MEMORY_BYTES))
        resource.setrlimit(resource.RLIMIT_FSIZE, (WORKER_FILE_BYTES, WORKER_FILE_BYTES))
        resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
        os.umask(0o077)
    except (ImportError, OSError, ValueError):
        return


def _package_version(name: str) -> str:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return "unavailable"


def _validate_pdf_bytes(document: bytes) -> None:
    header_offset = document[:1029].find(b"%PDF-")
    version = document[header_offset + 5 : header_offset + 8] if header_offset >= 0 else b""
    if header_offset < 0 or not re.fullmatch(rb"\d\.\d", version):
        raise RejectedDocument("malformed_document")
    if b"%%EOF" not in document[-2048:]:
        raise RejectedDocument("malformed_document")
    if ACTIVE_PDF_PATTERN.search(document):
        raise RejectedDocument("active_pdf")
    if re.search(rb"/Encrypt\b", document):
        raise RejectedDocument("encrypted_pdf")


def _inspect_image(path: str) -> tuple[int, int]:
    from PIL import Image

    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(path) as source:
                width, height = source.size
                if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
                    raise RejectedDocument("image_too_large")
                if int(getattr(source, "n_frames", 1)) != 1:
                    raise RejectedDocument("unsupported_document")
                source.verify()
                return width, height
    except RejectedDocument:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise RejectedDocument("image_too_large")
    except Exception as error:
        raise RejectedDocument("malformed_document") from error


def prepare_image(path: str, output_path: str) -> tuple[int, int]:
    from PIL import Image, ImageOps

    _inspect_image(path)
    try:
        with Image.open(path) as source:
            image = ImageOps.exif_transpose(source)
            width, height = image.size
            longest_side = max(width, height)
            if longest_side > IMAGE_MAX_SIDE:
                scale = IMAGE_MAX_SIDE / longest_side
                image = image.resize(
                    (max(1, round(width * scale)), max(1, round(height * scale))),
                    Image.Resampling.LANCZOS,
                )
            if image.mode != "RGB":
                converted = Image.new("RGB", image.size, "white")
                if "A" in image.getbands():
                    converted.paste(image, mask=image.getchannel("A"))
                else:
                    converted.paste(image)
                image = converted
            image.save(output_path, format="JPEG", quality=92, optimize=True)
            return image.size
    except RejectedDocument:
        raise
    except Exception as error:
        raise RejectedDocument("malformed_document") from error


def _parse_page_result(raw: Any, *, page_number: int, width: int, height: int) -> tuple[list[str], list[float], list[dict[str, Any]]]:
    text_lines: list[str] = []
    scores: list[float] = []
    regions: list[dict[str, Any]] = []
    if not isinstance(raw, list):
        return text_lines, scores, regions
    for block in raw:
        if len(regions) >= MAX_REGIONS:
            break
        if not isinstance(block, list):
            continue
        for line in block:
            if not isinstance(line, list) or len(line) < 2:
                continue
            box, payload = line[0], line[1]
            if not isinstance(payload, (list, tuple)) or len(payload) < 2:
                continue
            text = str(payload[0] or "").strip()
            if not text:
                continue
            try:
                confidence = max(0.0, min(1.0, float(payload[1])))
            except (TypeError, ValueError):
                confidence = 0.0
            polygon: list[list[float]] = []
            if isinstance(box, list):
                for point in box:
                    if not isinstance(point, (list, tuple)) or len(point) < 2:
                        continue
                    try:
                        x = max(0.0, min(1.0, float(point[0]) / max(width, 1)))
                        y = max(0.0, min(1.0, float(point[1]) / max(height, 1)))
                    except (TypeError, ValueError):
                        continue
                    polygon.append([round(x, 6), round(y, 6)])
            if len(polygon) < 3:
                continue
            xs = [point[0] for point in polygon]
            ys = [point[1] for point in polygon]
            text_lines.append(text)
            scores.append(confidence)
            regions.append({
                "text": text[:1000],
                "confidence": round(confidence, 6),
                "pageNumber": page_number,
                "x": min(xs),
                "y": min(ys),
                "width": round(max(xs) - min(xs), 6),
                "height": round(max(ys) - min(ys), 6),
                "polygon": polygon,
            })
            if len(regions) >= MAX_REGIONS:
                break
    return text_lines, scores, regions


def _get_model() -> Any:
    from paddleocr import PaddleOCR

    return PaddleOCR(use_angle_cls=True, lang="en", show_log=False)


def _ocr_image(path: str, model: Any, *, page_number: int) -> tuple[list[str], list[float], list[dict[str, Any]]]:
    with tempfile.NamedTemporaryFile(suffix=".jpg") as prepared:
        width, height = prepare_image(path, prepared.name)
        raw = model.ocr(prepared.name, cls=True)
    return _parse_page_result(raw, page_number=page_number, width=width, height=height)


def _open_pdf(path: str) -> Any:
    import pypdfium2 as pdfium

    document = Path(path).read_bytes()
    _validate_pdf_bytes(document)
    try:
        pdf = pdfium.PdfDocument(path)
        page_count = len(pdf)
    except Exception as error:
        message = str(error).lower()
        code = "encrypted_pdf" if "password" in message or "encrypt" in message else "malformed_document"
        raise RejectedDocument(code) from error
    if page_count < 1:
        pdf.close()
        raise RejectedDocument("malformed_document")
    if page_count > MAX_PAGES:
        pdf.close()
        raise RejectedDocument("too_many_pages")
    return pdf


def _page_render_size(page: Any) -> tuple[int, int]:
    try:
        width, height = page.get_size()
        rendered_width = math.ceil(float(width) * PDF_RENDER_SCALE)
        rendered_height = math.ceil(float(height) * PDF_RENDER_SCALE)
    except Exception as error:
        raise RejectedDocument("malformed_document") from error
    if rendered_width <= 0 or rendered_height <= 0 or rendered_width * rendered_height > MAX_IMAGE_PIXELS:
        raise RejectedDocument("image_too_large")
    return rendered_width, rendered_height


def extract_native_pdf_text(path: str) -> dict[str, Any]:
    started = time.perf_counter()
    pdf = _open_pdf(path)
    page_count = len(pdf)
    pages: list[str] = []
    remaining = MAX_NATIVE_TEXT_CHARS
    try:
        for index in range(page_count):
            page = pdf[index]
            try:
                text_page = page.get_textpage()
                try:
                    text = str(text_page.get_text_range(0, remaining) or "").strip() if remaining > 0 else ""
                finally:
                    text_page.close()
            except Exception as error:
                raise RejectedDocument("malformed_document") from error
            finally:
                page.close()
            if text and remaining > 0:
                pages.append(text[:remaining])
                remaining -= len(pages[-1])
    finally:
        pdf.close()
    text = "\n\n".join(pages).strip()[:MAX_NATIVE_TEXT_CHARS]
    return {
        "provider": "pdfium",
        "providerVersion": _package_version("pypdfium2"),
        "text": text,
        "pageCount": page_count,
        "characterCount": len(text),
        "durationMs": round((time.perf_counter() - started) * 1000),
    }


def extract_document(path: str, content_type: str) -> dict[str, Any]:
    started = time.perf_counter()
    all_text: list[str] = []
    all_scores: list[float] = []
    all_regions: list[dict[str, Any]] = []
    page_count = 1
    if content_type == "application/pdf":
        pdf = _open_pdf(path)
        page_count = len(pdf)
        try:
            for index in range(page_count):
                page = pdf[index]
                try:
                    _page_render_size(page)
                finally:
                    page.close()
        except Exception:
            pdf.close()
            raise
        model = _get_model()
        try:
            for index in range(page_count):
                page = pdf[index]
                try:
                    image = page.render(scale=PDF_RENDER_SCALE).to_pil()
                    try:
                        with tempfile.NamedTemporaryFile(suffix=".png") as temporary:
                            image.save(temporary.name, format="PNG")
                            text, scores, regions = _ocr_image(temporary.name, model, page_number=index + 1)
                    finally:
                        image.close()
                except RejectedDocument:
                    raise
                except Exception as error:
                    raise RejectedDocument("malformed_document") from error
                finally:
                    page.close()
                all_text.extend(text)
                all_scores.extend(scores)
                all_regions.extend(regions[: max(0, MAX_REGIONS - len(all_regions))])
                if len(all_regions) >= MAX_REGIONS:
                    break
        finally:
            pdf.close()
    else:
        _inspect_image(path)
        model = _get_model()
        all_text, all_scores, all_regions = _ocr_image(path, model, page_number=1)
    return {
        "provider": "paddleocr",
        "providerVersion": _package_version("paddleocr"),
        "confidence": round(sum(all_scores) / len(all_scores), 6) if all_scores else 0.0,
        "text": "\n".join(all_text)[:500_000],
        "pageCount": page_count,
        "regions": all_regions,
        "durationMs": round((time.perf_counter() - started) * 1000),
    }


def _write_envelope(output_path: str, envelope: dict[str, Any]) -> None:
    path = Path(output_path)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(envelope, separators=(",", ":")), encoding="utf-8")
    temporary.replace(path)


def main(argv: list[str]) -> int:
    _apply_resource_limits()
    if len(argv) != 5 or argv[1] not in {"ocr", "native-text"}:
        return 2
    operation, input_path, output_path, content_type = argv[1:]
    if content_type not in {"image/png", "image/jpeg", "image/webp", "application/pdf"}:
        _write_envelope(output_path, {"ok": False, "code": "unsupported_document"})
        return 0
    try:
        result = extract_native_pdf_text(input_path) if operation == "native-text" else extract_document(input_path, content_type)
        _write_envelope(output_path, {"ok": True, "result": result})
    except RejectedDocument as error:
        _write_envelope(output_path, {"ok": False, "code": error.code})
    except (MemoryError, OSError):
        _write_envelope(output_path, {"ok": False, "code": "ocr_failed"})
    except Exception:
        _write_envelope(output_path, {"ok": False, "code": "ocr_failed"})
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
