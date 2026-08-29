import { useEffect, useId, useRef, useState } from "react";
import { Scan } from "@untitledui/icons";
import { Button } from "../../components/ui/Button.jsx";
import { createInventoryFrameDetector } from "./inventory-camera-scanner.js";
import { createInventoryCameraSession } from "./inventory-camera-session.js";
import { inventoryScannerAvailable, normalizeInventoryCode } from "./inventory-code-scanner-model.js";

export function InventoryCodeScanner({
  onScan,
  disabled = false,
  resetKey = "",
  autoStart = false,
  labels = {},
}) {
  const text = {
    cameraLabel: "Serialized-part QR scanner camera",
    codeLabel: "Label link or code",
    codePlaceholder: "Paste or scan code",
    checking: "Checking…",
    openPart: "Open part",
    openError: "The serialized part could not be opened.",
    cameraUnavailable: "Camera scanning is not available here. Paste the label link or code below.",
    cameraAccessUnavailable: "Camera access was unavailable. Paste the label link or code below.",
    enterCode: "Enter code manually",
    ...labels,
  };
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [manualEntry, setManualEntry] = useState(false);
  const [message, setMessage] = useState("");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const inFlightRef = useRef(false);
  const cameraSessionRef = useRef(createInventoryCameraSession());
  const scanGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const inputId = useId();

  function stopCamera() {
    cameraSessionRef.current.cancel();
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
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
    setBusy(true);
    setMessage("");
    try {
      await onScan(value);
      if (generation !== scanGenerationRef.current || !mountedRef.current) return;
      setCode(value);
      stopCamera();
    } catch (error) {
      if (generation !== scanGenerationRef.current || !mountedRef.current) return;
      setMessage(labels.openError || error.message || text.openError);
    } finally {
      if (generation === scanGenerationRef.current && mountedRef.current) {
        inFlightRef.current = false;
        setBusy(false);
      }
    }
  }

  async function startCamera() {
    if (cameraActive) return;
    const session = cameraSessionRef.current;
    const token = session.begin();
    if (!token) return;
    setMessage("");
    setManualEntry(false);
    if (!inventoryScannerAvailable(window)) {
      setMessage(text.cameraUnavailable);
      setManualEntry(true);
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
        setManualEntry(true);
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
    setCode("");
    setMessage("");
    setManualEntry(false);
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
      {!manualEntry ? (
        <button type="button" className="inventory-code-manual-action" onClick={() => { stopCamera(); setManualEntry(true); }} disabled={disabled || busy}>
          {text.enterCode}
        </button>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); submit(code); }}>
          <label htmlFor={inputId}>
            <span>{text.codeLabel}</span>
            <input
              id={inputId}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck="false"
              placeholder={text.codePlaceholder}
              disabled={disabled || busy}
            />
          </label>
          <Button type="submit" icon={Scan} disabled={disabled || busy || !normalizeInventoryCode(code)}>
            {busy ? text.checking : text.openPart}
          </Button>
        </form>
      )}
      {message ? <p className="inventory-code-message" role="alert">{message}</p> : null}
    </section>
  );
}
