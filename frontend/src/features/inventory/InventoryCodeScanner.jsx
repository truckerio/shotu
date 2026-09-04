import { useEffect, useRef, useState } from "react";
import { createInventoryFrameDetector, enableInventoryCameraContinuousAutofocus } from "./inventory-camera-scanner.js";
import { createInventoryCameraSession } from "./inventory-camera-session.js";
import { inventoryScannerAvailable, normalizeInventoryCode } from "./inventory-code-scanner-model.js";

const CAMERA_ONLY_TEXT = Object.freeze({
  en: Object.freeze({
    cameraLabel: "Serialized-part QR scanner camera",
    openError: "The serialized part could not be opened. Camera restarting.",
    cameraUnavailable: "Camera scanning is unavailable on this device.",
    cameraAccessUnavailable: "Camera access failed. Check camera permission, then close and reopen the scanner.",
  }),
  es: Object.freeze({
    cameraLabel: "Cámara del escáner QR de piezas serializadas",
    openError: "No se pudo abrir la pieza serializada. Reiniciando la cámara.",
    cameraUnavailable: "El escaneo con cámara no está disponible en este dispositivo.",
    cameraAccessUnavailable: "Falló el acceso a la cámara. Revisa el permiso, cierra y vuelve a abrir el escáner.",
  }),
  pa: Object.freeze({
    cameraLabel: "ਸੀਰੀਅਲ ਪਾਰਟ QR ਸਕੈਨਰ ਕੈਮਰਾ",
    openError: "ਸੀਰੀਅਲ ਪਾਰਟ ਨਹੀਂ ਖੁੱਲ੍ਹ ਸਕਿਆ। ਕੈਮਰਾ ਮੁੜ ਚਾਲੂ ਹੋ ਰਿਹਾ ਹੈ।",
    cameraUnavailable: "ਇਸ ਡਿਵਾਈਸ ਉੱਤੇ ਕੈਮਰਾ ਸਕੈਨ ਉਪਲਬਧ ਨਹੀਂ ਹੈ।",
    cameraAccessUnavailable: "ਕੈਮਰਾ ਪਹੁੰਚ ਅਸਫਲ ਰਹੀ। ਕੈਮਰਾ ਇਜਾਜ਼ਤ ਜਾਂਚੋ, ਫਿਰ ਸਕੈਨਰ ਬੰਦ ਕਰਕੇ ਮੁੜ ਖੋਲ੍ਹੋ।",
  }),
});

export function InventoryCodeScanner({
  onScan,
  disabled = false,
  resetKey = "",
  autoStart = false,
  locale = "en",
  labels = {},
}) {
  const text = {
    ...(CAMERA_ONLY_TEXT[locale] || CAMERA_ONLY_TEXT.en),
    ...labels,
  };
  const [busy, setBusy] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [message, setMessage] = useState("");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const restartTimerRef = useRef(null);
  const inFlightRef = useRef(false);
  const cameraSessionRef = useRef(createInventoryCameraSession());
  const scanGenerationRef = useRef(0);
  const mountedRef = useRef(true);

  function stopCamera() {
    cameraSessionRef.current.cancel();
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
    restartTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (mountedRef.current) {
      setCameraActive(false);
      setCameraStarting(false);
    }
  }

  async function submit(rawValue) {
    const value = normalizeInventoryCode(rawValue);
    if (!value || disabled || inFlightRef.current) return;
    inFlightRef.current = true;
    const generation = scanGenerationRef.current;
    let restartAfterError = false;
    setBusy(true);
    setMessage("");
    try {
      await onScan(value);
      if (generation !== scanGenerationRef.current || !mountedRef.current) return;
      stopCamera();
    } catch (error) {
      if (generation !== scanGenerationRef.current || !mountedRef.current) return;
      setMessage(labels.openError || error.message || text.openError);
      restartAfterError = true;
    } finally {
      if (generation === scanGenerationRef.current && mountedRef.current) {
        inFlightRef.current = false;
        setBusy(false);
        if (restartAfterError) {
          restartTimerRef.current = window.setTimeout(() => {
            restartTimerRef.current = null;
            if (generation === scanGenerationRef.current && mountedRef.current) {
              startCamera({ preserveMessage: true });
            }
          }, 1200);
        }
      }
    }
  }

  async function startCamera({ preserveMessage = false } = {}) {
    if (streamRef.current) return;
    const session = cameraSessionRef.current;
    const token = session.begin();
    if (!token) return;
    if (!preserveMessage) setMessage("");
    if (!inventoryScannerAvailable(window)) {
      setMessage(text.cameraUnavailable);
      session.finish(token);
      return;
    }
    setCameraStarting(true);
    try {
      const detector = createInventoryFrameDetector(window);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (!mountedRef.current || !session.isCurrent(token)) {
        session.stopIfStale(token, stream);
        return;
      }
      await enableInventoryCameraContinuousAutofocus(stream);
      if (!mountedRef.current || !session.isCurrent(token)) {
        session.stopIfStale(token, stream);
        return;
      }
      streamRef.current = stream;
      setCameraActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      if (!mountedRef.current || !session.isCurrent(token)) {
        if (streamRef.current === stream) streamRef.current = null;
        session.stopIfStale(token, stream);
        return;
      }
      timerRef.current = window.setInterval(async () => {
        if (!session.isCurrent(token) || !videoRef.current || inFlightRef.current) return;
        try {
          const [result] = await detector.detect(videoRef.current);
          if (session.isCurrent(token) && result?.rawValue) {
            stopCamera();
            await submit(result.rawValue);
          }
        } catch {
          // Individual frames can fail while the camera focuses.
        }
      }, 300);
    } catch {
      if (mountedRef.current && session.isCurrent(token)) {
        stopCamera();
        setMessage(text.cameraAccessUnavailable);
      }
    } finally {
      if (mountedRef.current && session.isCurrent(token)) setCameraStarting(false);
      session.finish(token);
    }
  }

  useEffect(() => {
    scanGenerationRef.current += 1;
    inFlightRef.current = false;
    setBusy(false);
    setMessage("");
    stopCamera();
  }, [resetKey]);

  useEffect(() => {
    if (autoStart) startCamera();
  }, [autoStart, resetKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      scanGenerationRef.current += 1;
      stopCamera();
    };
  }, []);

  return (
    <section className="inventory-code-scanner" aria-label={text.cameraLabel}>
      <div className={`inventory-code-camera-stage${cameraActive || cameraStarting ? " is-active" : ""}`}>
        <video
          ref={videoRef}
          className="inventory-code-camera"
          muted
          playsInline
          aria-hidden="true"
        />
      </div>
      {message ? <p className="inventory-code-message" role="alert">{message}</p> : null}
    </section>
  );
}
