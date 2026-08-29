import assert from "node:assert/strict";
import test from "node:test";
import QRCode from "qrcode";
import { createInventoryFrameDetector, inventoryCameraAvailable } from "./inventory-camera-scanner.js";

function qrImageData(value, scale = 6, margin = 4) {
  const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
  const moduleCount = qr.modules.size;
  const size = (moduleCount + margin * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const moduleX = Math.floor(x / scale) - margin;
      const moduleY = Math.floor(y / scale) - margin;
      const dark = moduleX >= 0
        && moduleY >= 0
        && moduleX < moduleCount
        && moduleY < moduleCount
        && qr.modules.get(moduleX, moduleY);
      const offset = (y * size + x) * 4;
      const color = dark ? 0 : 255;
      data[offset] = color;
      data[offset + 1] = color;
      data[offset + 2] = color;
      data[offset + 3] = 255;
    }
  }

  return { data, width: size, height: size };
}

test("camera availability depends on capture support rather than BarcodeDetector", () => {
  assert.equal(inventoryCameraAvailable({ navigator: { mediaDevices: { getUserMedia() {} } } }), true);
  assert.equal(inventoryCameraAvailable({ BarcodeDetector: class {}, navigator: {} }), false);
});

test("frame detector prefers native barcode detection when available", async () => {
  class NativeDetector {
    constructor(options) {
      this.options = options;
    }

    async detect() {
      return [{ rawValue: "native-code" }];
    }
  }

  const detector = createInventoryFrameDetector({ BarcodeDetector: NativeDetector });
  assert.deepEqual(detector.options.formats, ["qr_code", "code_128"]);
  assert.deepEqual(await detector.detect({}), [{ rawValue: "native-code" }]);
});

test("frame detector falls back when a browser exposes an unusable native constructor", async () => {
  const expected = "serialized-fallback-token";
  const frame = qrImageData(expected);
  class UnusableNativeDetector {
    constructor() {
      throw new Error("not implemented");
    }
  }
  const detector = createInventoryFrameDetector({
    BarcodeDetector: UnusableNativeDetector,
    document: {
      createElement: () => ({
        getContext: () => ({
          drawImage() {},
          getImageData: () => frame,
        }),
      }),
    },
  });

  assert.deepEqual(await detector.detect({ videoWidth: frame.width, videoHeight: frame.height }), [
    { rawValue: expected, format: "qr_code" },
  ]);
});

test("frame detector decodes QR pixels without native BarcodeDetector", async () => {
  const expected = "https://example.test/inventory?inventoryScan=serialized-token";
  const frame = qrImageData(expected);
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return {
        drawImage() {},
        getImageData() {
          return frame;
        },
      };
    },
  };
  const detector = createInventoryFrameDetector({
    document: { createElement: () => canvas },
  });

  assert.deepEqual(await detector.detect({ videoWidth: frame.width, videoHeight: frame.height }), [
    { rawValue: expected, format: "qr_code" },
  ]);
});

test("fallback waits for video metadata before reading a frame", async () => {
  let frameRead = false;
  const detector = createInventoryFrameDetector({
    document: {
      createElement: () => ({
        getContext: () => ({
          drawImage() {},
          getImageData() {
            frameRead = true;
            return { data: new Uint8ClampedArray(), width: 0, height: 0 };
          },
        }),
      }),
    },
  });

  assert.deepEqual(await detector.detect({ videoWidth: 0, videoHeight: 0 }), []);
  assert.equal(frameRead, false);
});
