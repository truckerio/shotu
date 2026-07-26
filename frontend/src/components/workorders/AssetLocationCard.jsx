import { useEffect, useId, useRef, useState } from "react";
import { Pin01 } from "@untitledui/icons";
import { satelliteTiles } from "../../features/generator/GeneratorUi.jsx";

const MAP_HOVER_DELAY_MS = 1500;

export function getVehicleLocation(vehicle) {
  const gps = vehicle?.lastLocation || vehicle?.last_location || null;
  const latitude = Number(gps?.latitude);
  const longitude = Number(gps?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude,
    longitude,
    address: gps?.reverseGeo?.formattedLocation || gps?.address?.name || "",
    time: gps?.time || vehicle?.lastSeenAt || vehicle?.last_seen_at || "",
    speed: gps?.speedMilesPerHour,
  };
}

export function AssetLocationCard({
  vehicle,
  location = getVehicleLocation(vehicle),
  mapsConfig,
  showVehicleLabel = true,
}) {
  const cardRef = useRef(null);
  const hoverTimerRef = useRef(null);
  const mapPanelId = useId();
  const [mapOpen, setMapOpen] = useState(false);
  const [mapPinned, setMapPinned] = useState(false);
  const unitLabel = vehicle?.unitNo || vehicle?.unit_no || vehicle?.name || "Vehicle";
  const mapVisible = Boolean(location) && (mapOpen || mapPinned);

  function clearHoverTimer() {
    if (!hoverTimerRef.current) return;
    window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
  }

  function startHoverTimer(event) {
    if (event.pointerType !== "mouse" || !location || mapVisible) return;
    clearHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      setMapOpen(true);
    }, MAP_HOVER_DELAY_MS);
  }

  function leaveCard() {
    clearHoverTimer();
    if (!mapPinned) setMapOpen(false);
  }

  useEffect(() => () => clearHoverTimer(), []);

  useEffect(() => {
    if (!mapOpen || mapPinned) return undefined;

    const closeMapOutside = (event) => {
      if (!cardRef.current?.contains(event.target)) setMapOpen(false);
    };

    document.addEventListener("pointerdown", closeMapOutside);
    return () => document.removeEventListener("pointerdown", closeMapOutside);
  }, [mapOpen, mapPinned]);

  if (!vehicle?.id) return null;

  return (
    <div
      ref={cardRef}
      className={`asset-location-card ${mapVisible ? "is-map-visible" : ""} ${mapPinned ? "is-map-pinned" : ""}`}
      onPointerEnter={startHoverTimer}
      onPointerLeave={leaveCard}
    >
      <div className="asset-location-header">
        <button
          className="asset-location-copy asset-location-toggle"
          type="button"
          aria-controls={location ? mapPanelId : undefined}
          aria-expanded={mapVisible}
          disabled={!location}
          onClick={() => {
            clearHoverTimer();
            if (!mapPinned) setMapOpen((open) => !open);
          }}
        >
          {showVehicleLabel ? <strong>{unitLabel}</strong> : null}
          <span className="asset-location-address">
            {location ? (location.address || `${location.latitude}, ${location.longitude}`) : "Location not available yet"}
          </span>
        </button>
        <div className="asset-location-actions">
          {location ? (
            <button
              className="map-hover-trigger map-pin-button icon-tooltip"
              type="button"
              aria-label={mapPinned ? "Unpin satellite map" : "Pin satellite map open"}
              aria-controls={mapPanelId}
              aria-expanded={mapVisible}
              aria-pressed={mapPinned}
              data-tooltip={mapPinned ? "Unpin map" : "Pin map open"}
              onClick={() => {
                clearHoverTimer();
                setMapOpen(true);
                setMapPinned((pinned) => !pinned);
              }}
            >
              <Pin01 />
            </button>
          ) : null}
        </div>
      </div>
      {location ? (
        <div
          className="asset-map-hover"
          id={mapPanelId}
          role="group"
          aria-label="Satellite asset location"
          aria-hidden={!mapVisible}
          onClick={(event) => {
            if (mapPinned || event.target.closest?.("a, button")) return;
            setMapOpen(true);
            setMapPinned(true);
          }}
        >
          <div className="asset-map-tiles" aria-hidden="true">
            {satelliteTiles(location, mapsConfig).map((tile) => (
              <img key={tile.key} src={tile.src} alt="" loading="lazy" />
            ))}
            <span className="asset-map-pin" />
          </div>
          <div className="asset-map-meta">
            <span>{location.time ? new Date(location.time).toLocaleString() : "Live GPS"}</span>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`}
              target="_blank"
              rel="noreferrer"
            >
              Open map
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
