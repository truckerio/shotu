import { useEffect, useId, useRef, useState } from "react";
import { Pin01 } from "@untitledui/icons";
import { buildSatelliteTileLayer, MAX_SATELLITE_ZOOM } from "../../lib/maps/satellite-tiles.js";
import { createMapVisibilityController } from "../../lib/maps/map-visibility-controller.js";
import { MAP_SURFACE_TRANSITION_MS } from "../../lib/ui-timings.js";
import { interfaceText, intlLocale } from "../../i18n/index.js";
import "./asset-location-card.css";

const DESKTOP_MAP_QUERY = "(min-width: 701px)";
const ASSET_LOCATION_ZOOM = 19;
const MIN_ASSET_LOCATION_ZOOM = 17;
const MAX_ASSET_LOCATION_ZOOM = MAX_SATELLITE_ZOOM;

function isDesktopMapViewport() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia(DESKTOP_MAP_QUERY).matches;
}

function browserPixelRatio() {
  return typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio)
    ? Math.min(Math.max(window.devicePixelRatio, 1), 2)
    : 1;
}

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
  locale = "en",
  showVehicleLabel = true,
}) {
  const t = (key) => interfaceText(locale, key);
  const cardRef = useRef(null);
  const mapControllerRef = useRef(null);
  const mapPanelId = useId();
  const [mapOpen, setMapOpen] = useState(false);
  const [mapPinned, setMapPinned] = useState(false);
  const [mapContentMounted, setMapContentMounted] = useState(false);
  const [desktopMapOpen, setDesktopMapOpen] = useState(isDesktopMapViewport);
  const [mapZoom, setMapZoom] = useState(ASSET_LOCATION_ZOOM);
  const [mapPixelRatio, setMapPixelRatio] = useState(browserPixelRatio);
  if (!mapControllerRef.current) {
    mapControllerRef.current = createMapVisibilityController({
      onMount: () => setMapContentMounted(true),
      onExpand: () => setMapOpen(true),
      onCollapse: () => setMapOpen(false),
      onUnmount: () => setMapContentMounted(false),
    });
  }
  const unitLabel = vehicle?.unitNo || vehicle?.unit_no || vehicle?.name || t("location.vehicle");
  const mapVisible = Boolean(location) && (desktopMapOpen || mapOpen || mapPinned);
  const mapContentVisible = desktopMapOpen || mapContentMounted;
  const tileLayer = mapContentVisible && location
    ? buildSatelliteTileLayer(location, mapsConfig, mapZoom, { pixelRatio: mapPixelRatio })
    : null;
  const locationCopy = (
    <>
      {showVehicleLabel ? <strong>{unitLabel}</strong> : null}
      <span className="asset-location-address">
        {location ? (location.address || `${location.latitude}, ${location.longitude}`) : t("location.unavailable")}
      </span>
    </>
  );

  function enterCard(event) {
    if (desktopMapOpen || event.pointerType !== "mouse" || !location || mapPinned) return;
    mapControllerRef.current.cancelClose();
    if (!mapOpen) {
      mapControllerRef.current.open({ immediate: mapContentMounted });
    }
  }

  function leaveCard() {
    if (desktopMapOpen || mapPinned) return;
    mapControllerRef.current.close();
  }

  useEffect(() => () => mapControllerRef.current?.dispose(), []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mediaQuery = window.matchMedia(DESKTOP_MAP_QUERY);
    const syncDesktopMap = () => setDesktopMapOpen(mediaQuery.matches);
    syncDesktopMap();
    mediaQuery.addEventListener?.("change", syncDesktopMap);
    return () => mediaQuery.removeEventListener?.("change", syncDesktopMap);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const syncPixelRatio = () => setMapPixelRatio(browserPixelRatio());
    window.addEventListener("resize", syncPixelRatio);
    return () => window.removeEventListener("resize", syncPixelRatio);
  }, []);

  useEffect(() => {
    if (desktopMapOpen || !mapOpen || mapPinned) return undefined;

    const closeMapOutside = (event) => {
      if (cardRef.current?.contains(event.target)) return;
      mapControllerRef.current.close({ immediate: true });
    };

    document.addEventListener("pointerdown", closeMapOutside);
    return () => document.removeEventListener("pointerdown", closeMapOutside);
  }, [desktopMapOpen, mapOpen, mapPinned]);

  useEffect(() => {
    if (location) return;
    setMapPinned(false);
    mapControllerRef.current.reset();
  }, [location]);

  if (!vehicle?.id && !location) return null;

  return (
    <div
      ref={cardRef}
      className={`asset-location-card ${mapVisible ? "is-map-visible" : ""} ${mapPinned ? "is-map-pinned" : ""} ${desktopMapOpen ? "is-map-desktop" : ""}`}
      style={{ "--map-surface-transition": `${MAP_SURFACE_TRANSITION_MS}ms` }}
      onPointerEnter={enterCard}
      onPointerLeave={leaveCard}
    >
      <div className="asset-location-header">
        {desktopMapOpen ? (
          <div className="asset-location-copy">
            {locationCopy}
          </div>
        ) : (
          <button
            className="asset-location-copy asset-location-toggle"
            type="button"
            aria-controls={location ? mapPanelId : undefined}
            aria-expanded={mapVisible}
            disabled={!location}
            onClick={() => {
              if (mapPinned) return;
              if (mapOpen) mapControllerRef.current.close({ immediate: true });
              else mapControllerRef.current.open({ immediate: true });
            }}
          >
            {locationCopy}
          </button>
        )}
        <div className="asset-location-actions">
          {location && !desktopMapOpen ? (
            <button
              className="map-hover-trigger map-pin-button icon-tooltip"
              type="button"
              aria-label={t(mapPinned ? "location.unpinSatellite" : "location.pinSatellite")}
              aria-controls={mapPanelId}
              aria-expanded={mapVisible}
              aria-pressed={mapPinned}
              data-tooltip={t(mapPinned ? "location.unpinMap" : "location.pinMap")}
              onClick={() => {
                mapControllerRef.current.open({ immediate: true });
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
          aria-label={t("location.satelliteAsset")}
          aria-hidden={!mapVisible}
          onClick={(event) => {
            if (desktopMapOpen || mapPinned || event.target.closest?.("a, button")) return;
            mapControllerRef.current.open({ immediate: true });
            setMapPinned(true);
          }}
        >
          {mapContentVisible && tileLayer ? (
            <>
              <div className="asset-map-tiles">
                <div className="asset-map-tile-layer" style={tileLayer.layerStyle} aria-hidden="true">
                  {tileLayer.tiles.map((tile) => (
                    <img
                      key={tile.key}
                      src={tile.src}
                      alt=""
                      decoding="async"
                      fetchPriority={tile.priority ? "high" : "auto"}
                      loading="eager"
                      onError={(event) => {
                        if (!tile.fallbackSrc || event.currentTarget.dataset.fallbackApplied) return;
                        event.currentTarget.dataset.fallbackApplied = "true";
                        event.currentTarget.src = tile.fallbackSrc;
                      }}
                    />
                  ))}
                </div>
                <span className="asset-map-pin" aria-hidden="true" />
                <div className="asset-map-zoom-controls" role="group" aria-label={t("location.zoomControls")}>
                  <button
                    type="button"
                    aria-label={t("location.zoomIn")}
                    title={t("location.zoomIn")}
                    disabled={mapZoom >= MAX_ASSET_LOCATION_ZOOM}
                    onClick={() => setMapZoom((current) => Math.min(MAX_ASSET_LOCATION_ZOOM, current + 1))}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    aria-label={t("location.zoomOut")}
                    title={t("location.zoomOut")}
                    disabled={mapZoom <= MIN_ASSET_LOCATION_ZOOM}
                    onClick={() => setMapZoom((current) => Math.max(MIN_ASSET_LOCATION_ZOOM, current - 1))}
                  >
                    −
                  </button>
                </div>
              </div>
              <div className="asset-map-meta">
                <div className="asset-map-meta-copy">
                  <span>{location.time ? new Date(location.time).toLocaleString(intlLocale(locale)) : t("location.liveGps")}</span>
                  <small>{tileLayer.attribution}</small>
                </div>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
