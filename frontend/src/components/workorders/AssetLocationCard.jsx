import { useEffect, useId, useRef, useState } from "react";
import { Pin01 } from "@untitledui/icons";
import { buildHereLocationUrl, buildSatelliteTileLayer } from "../../lib/maps/satellite-tiles.js";
import { MAP_CLOSE_DELAY_MS, MAP_OPEN_DELAY_MS } from "../../lib/ui-timings.js";

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
  const openTimerRef = useRef(null);
  const closeTimerRef = useRef(null);
  const mapPanelId = useId();
  const [mapOpen, setMapOpen] = useState(false);
  const [mapPinned, setMapPinned] = useState(false);
  const unitLabel = vehicle?.unitNo || vehicle?.unit_no || vehicle?.name || "Vehicle";
  const mapVisible = Boolean(location) && (mapOpen || mapPinned);
  const tileLayer = mapVisible ? buildSatelliteTileLayer(location, mapsConfig) : null;

  function clearOpenTimer() {
    if (!openTimerRef.current) return;
    window.clearTimeout(openTimerRef.current);
    openTimerRef.current = null;
  }

  function clearCloseTimer() {
    if (!closeTimerRef.current) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }

  function enterCard(event) {
    clearCloseTimer();
    if (event.pointerType !== "mouse" || !location || mapVisible) return;
    clearOpenTimer();
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null;
      setMapOpen(true);
    }, MAP_OPEN_DELAY_MS);
  }

  function leaveCard() {
    clearOpenTimer();
    if (mapPinned) return;
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setMapOpen(false);
    }, MAP_CLOSE_DELAY_MS);
  }

  useEffect(() => () => {
    clearOpenTimer();
    clearCloseTimer();
  }, []);

  useEffect(() => {
    if (!mapOpen || mapPinned) return undefined;

    const closeMapOutside = (event) => {
      if (cardRef.current?.contains(event.target)) return;
      clearCloseTimer();
      setMapOpen(false);
    };

    document.addEventListener("pointerdown", closeMapOutside);
    return () => document.removeEventListener("pointerdown", closeMapOutside);
  }, [mapOpen, mapPinned]);

  if (!vehicle?.id) return null;

  return (
    <div
      ref={cardRef}
      className={`asset-location-card ${mapVisible ? "is-map-visible" : ""} ${mapPinned ? "is-map-pinned" : ""}`}
      onPointerEnter={enterCard}
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
            clearOpenTimer();
            clearCloseTimer();
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
                clearOpenTimer();
                clearCloseTimer();
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
            clearCloseTimer();
            setMapOpen(true);
            setMapPinned(true);
          }}
        >
          {mapVisible && tileLayer ? (
            <>
              <div className="asset-map-tiles" aria-hidden="true">
                <div className="asset-map-tile-layer" style={tileLayer.layerStyle}>
                  {tileLayer.tiles.map((tile) => (
                    <img
                      key={tile.key}
                      src={tile.src}
                      alt=""
                      loading="lazy"
                      onError={(event) => {
                        if (!tile.fallbackSrc || event.currentTarget.dataset.fallbackApplied) return;
                        event.currentTarget.dataset.fallbackApplied = "true";
                        event.currentTarget.src = tile.fallbackSrc;
                      }}
                    />
                  ))}
                </div>
                <span className="asset-map-pin" />
              </div>
              <div className="asset-map-meta">
                <div className="asset-map-meta-copy">
                  <span>{location.time ? new Date(location.time).toLocaleString() : "Live GPS"}</span>
                  <small>{tileLayer.attribution}</small>
                </div>
                <a
                  href={buildHereLocationUrl(location)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in HERE
                </a>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
