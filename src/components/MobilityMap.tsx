import { useEffect, useRef, useState } from 'react';
import type { Map as LibreMap, Marker as LibreMarker } from 'maplibre-gl';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { Origin, Place, Vehicle } from '../lib/types';
import './MobilityMap.css';

type Props = { origin: Origin; places: Place[]; vehicles?: Vehicle[]; interactive?: boolean; onOriginChange?: (origin: Origin) => void; theme?: 'dark' | 'light'; placeLabels?: string[]; vehicleLabels?: string[] };
export default function MobilityMap({ origin, places, vehicles = [], interactive = false, onOriginChange, theme = 'dark', placeLabels, vehicleLabels }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LibreMap | null>(null);
  const markers = useRef<LibreMarker[]>([]);
  const onChange = useRef(onOriginChange); onChange.current = onOriginChange;
  const originRef = useRef(origin); originRef.current = origin;
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [generation, setGeneration] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const key = import.meta.env.VITE_PROTOMAPS_API_KEY as string | undefined;
  const customStyle = import.meta.env.VITE_MAP_STYLE_URL as string | undefined;
  const markerKey = JSON.stringify([origin, places.map((place, i) => [place.id, place.lat, place.lon, place.name, place.kind, placeLabels?.[i]]), vehicles.map((vehicle, i) => [vehicle.id, vehicle.lat, vehicle.lon, vehicle.location_label, vehicleLabels?.[i]])]);

  useEffect(() => {
    let disposed = false;
    let resize: ResizeObserver | undefined;
    if (!key && !customStyle) { setStatus('unavailable'); return; }
    setStatus('loading');
    const watchdog = setTimeout(() => { if (!disposed) setStatus(current => current === 'ready' ? current : 'unavailable'); }, 15000);
    void Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]).then(([libre]) => {
      if (disposed || !container.current) return;
      try {
        // MapLibre 6 resolves its worker relative to import.meta.url by default.
        // Vite moves the main module, so explicitly bundle and reference the worker.
        libre.setWorkerUrl(mapWorkerUrl);
        const instance = new libre.Map({ container: container.current, style: customStyle || `https://api.protomaps.com/styles/v5/${theme}/en.json?key=${encodeURIComponent(key!)}`, center: [originRef.current.lon, originRef.current.lat], zoom: 14.4, minZoom: 10, maxZoom: 18, interactive, attributionControl: false, renderWorldCopies: false });
        map.current = instance;
        instance.addControl(new libre.AttributionControl({ compact: true }), 'bottom-right');
        if (interactive) instance.addControl(new libre.NavigationControl({ showCompass: false }), 'top-right');
        instance.on('load', () => { if (!disposed) { clearTimeout(watchdog); setStatus('ready'); setGeneration(value => value + 1); } });
        instance.on('error', event => {
          if (!disposed) setStatus('unavailable');
          if (import.meta.env.DEV) console.warn('Map could not load:', String(event.error?.message || 'Unknown map error').split(key || '__no_key__').join('[redacted]'));
        });
        instance.on('idle', () => { if (!disposed && instance.isStyleLoaded() && instance.areTilesLoaded()) setStatus('ready'); });
        if (interactive) instance.on('click', event => {
          if (event.lngLat.lat >= 41.6 && event.lngLat.lat <= 42.1 && event.lngLat.lng >= -88 && event.lngLat.lng <= -87.45) onChange.current?.({ lat: event.lngLat.lat, lon: event.lngLat.lng });
        });
        resize = new ResizeObserver(() => instance.resize()); resize.observe(container.current);
      } catch (error) { if (!disposed) setStatus('unavailable'); if (import.meta.env.DEV) console.warn('Map initialization failed:', String(error).split(key || '__no_key__').join('[redacted]')); }
    }).catch(() => { if (!disposed) setStatus('unavailable'); });
    return () => { disposed = true; clearTimeout(watchdog); resize?.disconnect(); markers.current.forEach(marker => marker.remove()); markers.current = []; map.current?.remove(); map.current = null; };
  }, [key, customStyle, theme, interactive, attempt]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    instance.jumpTo({ center: [origin.lon, origin.lat] });
  }, [origin.lat, origin.lon, generation]);

  useEffect(() => {
    let disposed = false;
    const instance = map.current;
    if (!instance) return;
    void import('maplibre-gl').then(libre => {
      if (disposed || !map.current) return;
      markers.current.forEach(marker => marker.remove()); markers.current = [];
      const add = (point: Origin, label: string, title: string, kind: string) => {
        const element = document.createElement('div'); element.className = `mobility-marker ${kind}`; element.textContent = label; element.title = title; element.setAttribute('aria-label', title);
        markers.current.push(new libre.Marker({ element }).setLngLat([point.lon, point.lat]).addTo(instance));
      };
      add(origin, '', 'Your board location', 'origin-marker');
      places.forEach((place, i) => add(place, placeLabels?.[i] ?? String(i + 1).padStart(2, '0'), place.name, place.kind === 'shared_station' ? 'shared-marker' : 'transit-marker'));
      vehicles.forEach((vehicle, i) => add(vehicle, vehicleLabels?.[i] ?? `B${i + 1}`, vehicle.location_label || 'Shared vehicle', 'vehicle-marker'));
    });
    return () => { disposed = true; };
  }, [markerKey, generation]);

  return <div className={`mobility-map-container map-${theme}`}>
    <div className="mobility-map-canvas" ref={container} aria-label={interactive ? 'Interactive neighborhood map. Click to set your entrance; coordinate inputs are also available.' : 'Map of selected neighborhood mobility options'} />
    {status !== 'ready' && <div className="map-state" role="status"><span className="map-state-symbol">⌖</span><strong>{status === 'loading' ? 'Finding your neighborhood…' : 'Map unavailable'}</strong><p>{status === 'loading' ? 'Protomaps · Chicago' : !key && !customStyle ? 'Add a Protomaps key to .env.local to enable the map. Your board and stop list still work.' : 'Your stop list and board still work. Map tiles will retry as the connection recovers.'}</p>{status === 'unavailable' && (key || customStyle) && <button type="button" className="map-retry" onClick={() => setAttempt(value => value + 1)}>Retry map</button>}</div>}
    <div className="map-attribution"><a href="https://protomaps.com" target="_blank" rel="noreferrer">Protomaps</a><span>©</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a></div>
  </div>;
}
