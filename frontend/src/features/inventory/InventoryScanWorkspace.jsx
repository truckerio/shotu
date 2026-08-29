import { useEffect, useRef, useState } from "react";
import { Camera01, CheckCircle, Scan } from "@untitledui/icons";
import { Button } from "../../components/ui/Button.jsx";
import { api } from "../../lib/api.js";
import { createInventoryFrameDetector, inventoryCameraAvailable } from "./inventory-camera-scanner.js";
import { createInventoryCameraSession } from "./inventory-camera-session.js";
import "./inventory-scan.css";

function initialCode() {
  return new URLSearchParams(window.location.search).get("inventoryScan") || "";
}

function eventLabel(type) {
  return {
    receipt_staged: "Identity prepared",
    receipt_confirmed: "Received in Odoo",
    receipt_recorded: "Added to local inventory",
    reconciliation_required: "Needs reconciliation",
    void: "Voided",
  }[type] || type.replaceAll("_", " ");
}

export function InventoryScanWorkspace({ actor }) {
  const [code, setCode] = useState(initialCode);
  const [unit, setUnit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const resolveInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const cameraSessionRef = useRef(createInventoryCameraSession());

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

  async function resolve(codeValue) {
    const next = String(codeValue || "").trim();
    if (!next || resolveInFlightRef.current) return;
    resolveInFlightRef.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await api("/api/inventory/resolve", {
        method: "POST",
        body: JSON.stringify({ code: next }),
      });
      if (!mountedRef.current) return;
      setUnit(result.unit);
      setCode(next);
      stopCamera();
    } catch (error) {
      if (!mountedRef.current) return;
      setUnit(null);
      setMessage(error.message);
    } finally {
      resolveInFlightRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    const saved = initialCode();
    if (saved) resolve(saved);
    return () => {
      mountedRef.current = false;
      stopCamera();
    };
  }, []);

  async function startCamera() {
    const session = cameraSessionRef.current;
    const token = session.begin();
    if (!token) return;
    setMessage("");
    if (!inventoryCameraAvailable(window)) {
      setMessage("Camera scanning is not available here. Paste the label link or enter its code below.");
      session.finish(token);
      return;
    }
    setCameraStarting(true);
    try {
      const detector = createInventoryFrameDetector(window);
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
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
        if (!session.isCurrent(token) || !videoRef.current || resolveInFlightRef.current) return;
        try {
          const [result] = await detector.detect(videoRef.current);
          if (session.isCurrent(token) && result?.rawValue) await resolve(result.rawValue);
        } catch {
          // A frame can fail while the camera focuses; the next frame remains safe to try.
        }
      }, 300);
    } catch {
      if (mountedRef.current && session.isCurrent(token)) {
        stopCamera();
        setMessage("Camera access was unavailable. Paste the label link or enter its code below.");
      }
    } finally {
      if (mountedRef.current && session.isCurrent(token)) setCameraStarting(false);
      session.finish(token);
    }
  }

  return (
    <main className="inventory-scan-workspace">
      <section className="inventory-scan-card" aria-labelledby="inventory-scan-title">
        <header>
          <span className="inventory-scan-icon"><Scan aria-hidden="true" /></span>
          <div><h1 id="inventory-scan-title">Scan part</h1><p>{actor?.name ? `${actor.name} · ` : ""}One label opens one exact inventory unit.</p></div>
        </header>
        {unit ? (
          <section className="inventory-scan-result" aria-live="polite">
            <div className="inventory-scan-status"><CheckCircle aria-hidden="true" /><span><strong>{unit.status === "in_stock" ? "In stock" : unit.status.replaceAll("_", " ")}</strong><small>{unit.locationName}</small></span></div>
            <dl>
              <div><dt>Part</dt><dd><strong>{unit.partNumber}</strong><span>{unit.description}</span></dd></div>
              <div><dt>Serial</dt><dd><code>{unit.serialNumber}</code></dd></div>
              <div><dt>Receipt</dt><dd>{unit.receipt.provider === "local" ? "Local invoice receipt" : unit.receipt.reference || "Odoo receipt"}</dd></div>
            </dl>
            <ol className="inventory-scan-history">
              {unit.events.map((event) => <li key={`${event.type}-${event.at}`}><span>{eventLabel(event.type)}</span><time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time></li>)}
            </ol>
            <Button type="button" onClick={() => { setUnit(null); setCode(""); }}>Scan another</Button>
          </section>
        ) : (
          <>
            <video ref={videoRef} className={`inventory-camera${cameraActive ? " is-active" : ""}`} muted playsInline aria-label="QR scanner camera" />
            <Button type="button" variant="primary" icon={Camera01} onClick={cameraActive ? stopCamera : startCamera} disabled={busy || cameraStarting}>
              {cameraActive ? "Stop camera" : cameraStarting ? "Starting camera…" : "Use camera"}
            </Button>
            <form onSubmit={(event) => { event.preventDefault(); resolve(code); }}>
              <label htmlFor="inventory-code"><span>Label link or code</span><input id="inventory-code" value={code} onChange={(event) => setCode(event.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck="false" placeholder="Paste or scan code" /></label>
              <Button type="submit" icon={Scan} disabled={busy || !code.trim()}>{busy ? "Checking…" : "Open part"}</Button>
            </form>
          </>
        )}
        {message ? <p className="inventory-scan-message" role="alert">{message}</p> : null}
        <Button className="inventory-scan-back" type="button" onClick={() => window.location.assign("/")}>Back to workspace</Button>
      </section>
    </main>
  );
}
