import jsQR from "jsqr";

const NATIVE_FORMATS = ["qr_code"];
const MAX_FALLBACK_EDGE = 1280;

export function inventoryCameraAvailable(environment = globalThis) {
  return Boolean(environment?.navigator?.mediaDevices?.getUserMedia);
}

export async function enableInventoryCameraContinuousAutofocus(stream) {
  try {
    const track = stream?.getVideoTracks?.().find((candidate) => candidate?.readyState !== "ended");
    if (!track?.getCapabilities || !track?.applyConstraints) return false;

    const focusModes = track.getCapabilities()?.focusMode;
    if (!Array.isArray(focusModes) || !focusModes.includes("continuous")) return false;

    await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
    return true;
  } catch {
    return false;
  }
}

function createNativeDetector(BarcodeDetector) {
  try {
    return new BarcodeDetector({ formats: NATIVE_FORMATS });
  } catch {
    return null;
  }
}

function fallbackFrameSize(source) {
  const sourceWidth = Number(source?.videoWidth || source?.naturalWidth || source?.width || 0);
  const sourceHeight = Number(source?.videoHeight || source?.naturalHeight || source?.height || 0);
  if (!sourceWidth || !sourceHeight) return null;

  const scale = Math.min(1, MAX_FALLBACK_EDGE / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

function createQrFallbackDetector(environment) {
  const canvas = environment?.document?.createElement?.("canvas");
  const context = canvas?.getContext?.("2d", { willReadFrequently: true });
  if (!canvas || !context) throw new Error("Camera QR decoding is unavailable in this browser.");

  return {
    async detect(source) {
      const size = fallbackFrameSize(source);
      if (!size) return [];
      if (canvas.width !== size.width) canvas.width = size.width;
      if (canvas.height !== size.height) canvas.height = size.height;
      context.drawImage(source, 0, 0, size.width, size.height);
      const frame = context.getImageData(0, 0, size.width, size.height);
      const result = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "attemptBoth" });
      return result?.data ? [{ rawValue: result.data, format: "qr_code" }] : [];
    },
  };
}

export function createInventoryFrameDetector(environment = globalThis) {
  if (environment?.BarcodeDetector) {
    const nativeDetector = createNativeDetector(environment.BarcodeDetector);
    if (nativeDetector) return nativeDetector;
  }
  return createQrFallbackDetector(environment);
}
