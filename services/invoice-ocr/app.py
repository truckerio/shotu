from __future__ import annotations

import asyncio
import importlib.metadata
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse


MAX_DOCUMENT_BYTES = min(20 * 1024 * 1024, max(1, int(os.getenv("OCR_MAX_DOCUMENT_BYTES", str(10 * 1024 * 1024)))))
MAX_PAGES = min(10, max(1, int(os.getenv("OCR_MAX_PAGES", "3"))))
MAX_REGIONS = min(10_000, max(100, int(os.getenv("OCR_MAX_REGIONS", "5000"))))
PDF_RENDER_SCALE = min(3.0, max(1.0, float(os.getenv("OCR_PDF_RENDER_SCALE", "1.35"))))
SERVICE_TOKEN = os.getenv("OCR_SERVICE_TOKEN", "").strip()
ALLOWED_TYPES = {"image/png", "image/jpeg", "image/webp", "application/pdf"}

app = FastAPI(title="Workorder Invoice OCR", docs_url=None, redoc_url=None, openapi_url=None)
_model: Any | None = None
_model_lock = threading.Lock()
_inference_lock = asyncio.Lock()


def _package_version(name: str) -> str:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return "unavailable"


def _get_model() -> Any:
    global _model
    if _model is not None:
        return _model
    with _model_lock:
        if _model is None:
            from paddleocr import PaddleOCR

            _model = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
    return _model


def _suffix(content_type: str) -> str:
    return {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
        "application/pdf": ".pdf",
    }[content_type]


def _parse_page_result(raw: Any, *, page_number: int, width: int, height: int) -> tuple[list[str], list[float], list[dict[str, Any]]]:
    text_lines: list[str] = []
    scores: list[float] = []
    regions: list[dict[str, Any]] = []
    if not isinstance(raw, list):
        return text_lines, scores, regions
    for block in raw:
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
            regions.append(
                {
                    "text": text[:1000],
                    "confidence": round(confidence, 6),
                    "pageNumber": page_number,
                    "x": min(xs),
                    "y": min(ys),
                    "width": round(max(xs) - min(xs), 6),
                    "height": round(max(ys) - min(ys), 6),
                    "polygon": polygon,
                }
            )
            if len(regions) >= MAX_REGIONS:
                break
    return text_lines, scores, regions


def _ocr_image(path: str, *, page_number: int) -> tuple[list[str], list[float], list[dict[str, Any]]]:
    from PIL import Image

    with Image.open(path) as image:
        width, height = image.size
    raw = _get_model().ocr(path, cls=True)
    return _parse_page_result(raw, page_number=page_number, width=width, height=height)


def _extract_document(document: bytes, content_type: str) -> dict[str, Any]:
    started = time.perf_counter()
    all_text: list[str] = []
    all_scores: list[float] = []
    all_regions: list[dict[str, Any]] = []
    page_count = 1

    if content_type == "application/pdf":
        import pypdfium2 as pdfium

        pdf = pdfium.PdfDocument(document)
        page_count = min(len(pdf), MAX_PAGES)
        try:
            for index in range(page_count):
                page = pdf[index]
                try:
                    image = page.render(scale=PDF_RENDER_SCALE).to_pil()
                    with tempfile.NamedTemporaryFile(suffix=".png") as temporary:
                        image.save(temporary.name, format="PNG")
                        text, scores, regions = _ocr_image(temporary.name, page_number=index + 1)
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
        with tempfile.NamedTemporaryFile(suffix=_suffix(content_type)) as temporary:
            temporary.write(document)
            temporary.flush()
            all_text, all_scores, all_regions = _ocr_image(temporary.name, page_number=1)

    return {
        "provider": "paddleocr",
        "providerVersion": _package_version("paddleocr"),
        "confidence": round(sum(all_scores) / len(all_scores), 6) if all_scores else 0.0,
        "text": "\n".join(all_text)[:500_000],
        "pageCount": page_count,
        "regions": all_regions,
        "durationMs": round((time.perf_counter() - started) * 1000),
    }


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
    }


@app.post("/v1/ocr")
async def extract_ocr(request: Request) -> dict[str, Any]:
    if SERVICE_TOKEN and request.headers.get("x-ocr-token", "") != SERVICE_TOKEN:
        raise HTTPException(status_code=404, detail="Not found")
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported document type")
    declared_length = request.headers.get("content-length")
    if declared_length and int(declared_length) > MAX_DOCUMENT_BYTES:
        raise HTTPException(status_code=413, detail="Document too large")
    document = await request.body()
    if not document:
        raise HTTPException(status_code=400, detail="Empty document")
    if len(document) > MAX_DOCUMENT_BYTES:
        raise HTTPException(status_code=413, detail="Document too large")
    async with _inference_lock:
        return await asyncio.to_thread(_extract_document, document, content_type)
