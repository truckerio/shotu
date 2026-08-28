import { useEffect, useId, useRef, useState } from "react";
import { Camera01, Scan } from "@untitledui/icons";
import { Button } from "../../components/ui/Button.jsx";
import { inventoryScannerAvailable, normalizeInventoryCode } from "./inventory-code-scanner-model.js";

export function InventoryCodeScanner({
  onScan,
  disabled = false,
  resetKey = "",
  title = "Scan serialized part",
  labels = {},
}) {
  const text = {
    cameraLabel: "Serialized-part QR scanner camera",
    stopCamera: "Stop camera",
    startingCamera: "Starting camera…",
    useCamera: "Use camera",
    codeLabel: "Label link or code",
    codePlaceholder: "Paste or scan code",
    checking: "Checking…",
    openPart: "Open part",
    openError: "The serialized part could not be opened.",
    cameraUnavailable: "Camera scanning is not available here. Paste the label link or code below.",
    cameraAccessUnavailable: "Camera access was unavailable. Paste the label link or code below.",
    ...labels,
  };
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [message, setMessage] = useState("");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const inFlightRef = useRef(false);
  const cameraGenerationRef = useRef(0);
  const scanGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const titleId = useId();
  const inputId = useId();

  function stopCamera() {
    cameraGenerationRef.current += 1;
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
    if (cameraStarting || cameraActive) return;
    setMessage("");
    if (!inventoryScannerAvailable(window)) {
      setMessage(text.cameraUnavailable);
      return;
    }
    const generation = cameraGenerationRef.current + 1;
    cameraGenerationRef.current = generation;
    setCameraStarting(true);
    try {
      const detector = new window.BarcodeDetector({ formats: ["qr_code", "code_128"] });
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (!mountedRef.current || generation !== cameraGenerationRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      setCameraActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      if (!mountedRef.current || generation !== cameraGenerationRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      timerRef.current = window.setInterval(async () => {
        if (!videoRef.current || inFlightRef.current) return;
        try {
          const [result] = await detector.detect(videoRef.current);
          if (result?.rawValue) await submit(result.rawValue);
        } catch {
          // Individual frames can fail while the camera focuses.
        }
      }, 300);
    } catch {
      if (mountedRef.current && generation === cameraGenerationRef.current) {
        stopCamera();
        setMessage(text.cameraAccessUnavailable);
      }
    } finally {
      if (mountedRef.current && generation === cameraGenerationRef.current) setCameraStarting(false);
    }
  }

  useEffect(() => {
    scanGenerationRef.current += 1;
    inFlightRef.current = false;
    setBusy(false);
    setCode("");
    setMessage("");
    stopCamera();
  }, [resetKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      scanGenerationRef.current += 1;
      cameraGenerationRef.current += 1;
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  return (
    <section className="inventory-code-scanner" aria-labelledby={titleId}>
      <h4 id={titleId}>{title}</h4>
      <video
        ref={videoRef}
        className={`inventory-code-camera${cameraActive ? " is-active" : ""}`}
        muted
        playsInline
        aria-label={text.cameraLabel}
      />
      <Button
        type="button"
        variant="primary"
        icon={Camera01}
        onClick={cameraActive ? stopCamera : startCamera}
        disabled={disabled || busy || cameraStarting}
      >
        {cameraActive ? text.stopCamera : cameraStarting ? text.startingCamera : text.useCamera}
      </Button>
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
      {message ? <p className="inventory-code-message" role="alert">{message}</p> : null}
    </section>
  );
}
