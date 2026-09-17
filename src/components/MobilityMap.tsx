import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as LibreMap } from 'maplibre-gl';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Bike, LocateFixed, Minus, Plus, X, Zap } from 'lucide-react';
import type { BoardCard, Origin, Place, Vehicle } from '../lib/types';
import { availableVehicles, cardState, departureGroups } from '../lib/presentation';
import { distanceMeters, formatEvent } from '../lib/format';
import { placeMapLabels } from '../lib/map-layout';
import { loadRoutes, type RouteCollection } from '../lib/routes';
import OperatorLabel from './OperatorLabel';
import { metraDisclaimer, stationDataDate } from '../lib/data-notices';
import './MobilityMap.css';

type Props = {
  origin: Origin; places: Place[]; vehicles?: Vehicle[]; cards?: BoardCard[];
  interactive?: boolean; onOriginChange?: (origin: Origin) => void; theme?: 'dark' | 'light';
  now?: number; online?: boolean; mode?: 'demo' | 'live'; timeFormat?: '12h' | '24h';
  catalogVersion?: string;
  focusKey?: number;
};
const layerNames = { bus: 'CTA bus', rail: 'CTA rail', metra: 'Metra' } as const;

function MapCardInfo({ card, now, online, timeFormat }: { card: BoardCard; now: number; online: boolean; timeFormat: '12h' | '24h' }) {
  const state = cardState(card, now, online);
  if (state === 'unavailable') return <span className="map-data-status">{card.state === 'not_connected' ? 'Departures not connected' : card.state === 'loading' ? 'Loading arrivals…' : 'Data unavailable'}</span>;
  if (card.kind === 'shared_station') {
    if (card.availability?.rental_state === 'unavailable') return <span className="map-data-status">Rentals closed</span>;
    return <><span className="map-bike-counts"><span><Bike size={14} aria-hidden="true" /><b>{card.availability?.classic ?? '—'}</b> pedal</span><span><Zap size={14} aria-hidden="true" /><b>{card.availability?.electric ?? '—'}</b> e-bikes</span></span>{card.availability?.rental_state !== 'available' && <span className="map-data-status">Rental status unknown</span>}{state === 'stale' && <span className="map-data-status">{online ? 'Stale availability' : 'Offline · last known counts'}</span>}</>;
  }
  const groups = departureGroups(card.events, now);
  return <>{groups.length ? groups.map(group => <span className="map-departure" key={`${group.route}:${group.destination}`}>
    <span className="map-destination"><b>{group.route}</b> · {group.destination}</span>
    <span className="map-times">{group.events.map(event => <span key={event.id}>{formatEvent(event, now, timeFormat).replace(/^Scheduled\s*[·:]\s*/, '')}{event.time_basis === 'schedule' && !group.events.every(item => item.time_basis === 'schedule') && <small>Scheduled</small>}</span>)}</span>
    {group.events.every(event => event.time_basis === 'schedule') && <small>Scheduled</small>}
  </span>) : <span className="map-data-status">No predictions available</span>}{state === 'stale' && <span className="map-data-status">{online ? 'Stale predictions' : 'Offline · last known predictions'}</span>}</>;
}

export default function MobilityMap({ origin, places, vehicles = [], cards = [], interactive = false, onOriginChange, theme = 'dark', now = Date.now(), online = true, mode = 'live', timeFormat = '12h', catalogVersion = '', focusKey = 0 }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LibreMap | null>(null);
  const onChange = useRef(onOriginChange); onChange.current = onOriginChange;
  const originRef = useRef(origin); originRef.current = origin;
  const fitRef = useRef<() => void>(() => {});
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [generation, setGeneration] = useState(0);
  const [view, setView] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [routes, setRoutes] = useState<RouteCollection>();
  const [routesError, setRoutesError] = useState(false);
  const [layers, setLayers] = useState({ bus: true, rail: true, metra: true });
  const [selected, setSelected] = useState<string>();
  const selectedTrigger = useRef<HTMLButtonElement | null>(null);
  const detailClose = useRef<HTMLButtonElement>(null);
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const labelElements = useRef(new Map<string, HTMLButtonElement>());
  const key = import.meta.env.VITE_PROTOMAPS_API_KEY as string | undefined;
  const customStyle = import.meta.env.VITE_MAP_STYLE_URL as string | undefined;
  const editing = Boolean(onOriginChange);
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mergedCards = useMemo(() => {
    const grouped = new Map<string, BoardCard>();
    for (const card of cards) {
      if (!card.place) continue;
      const previous = grouped.get(card.place.id);
      grouped.set(card.place.id, previous ? { ...previous, events: [...previous.events, ...card.events] } : card);
    }
    return grouped;
  }, [cards]);
  const visibleVehicles = cards.length ? [...new Map(cards.flatMap(card => availableVehicles(card, now, online)).map(vehicle => [vehicle.id, vehicle])).values()] : vehicles;
  const fitKey = JSON.stringify([origin, places.map(place => [place.id, place.lat, place.lon]), visibleVehicles.map(vehicle => vehicle.id)]);
  // Pin placement and vehicle polling must not reset a view the user is exploring.
  const cameraKey = editing ? focusKey : JSON.stringify([origin, places.map(place => [place.id, place.lat, place.lon])]);
  const vehiclePositionsKey = JSON.stringify(visibleVehicles.map(vehicle => [vehicle.id, vehicle.lat, vehicle.lon]));
  const closeDetail = () => { setSelected(undefined); selectedTrigger.current?.focus(); };
  useEffect(() => { if (selected) detailClose.current?.focus(); }, [selected]);

  useEffect(() => {
    let active = true;
    setRoutesError(false);
    void loadRoutes().then(data => { if (active) setRoutes(data); }).catch(() => { if (active) setRoutesError(true); });
    return () => { active = false; };
  }, [attempt]);

  useEffect(() => {
    let disposed = false;
    let resize: ResizeObserver | undefined;
    let frame = 0;
    if (!key && !customStyle) { setStatus('unavailable'); return; }
    setStatus('loading');
    const watchdog = setTimeout(() => { if (!disposed) setStatus(current => current === 'ready' ? current : 'unavailable'); }, 15000);
    void Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]).then(([libre]) => {
      if (disposed || !container.current) return;
      try {
        libre.setWorkerUrl(mapWorkerUrl);
        const instance = new libre.Map({ container: container.current, style: customStyle || `https://api.protomaps.com/styles/v5/${theme}/en.json?key=${encodeURIComponent(key!)}`, center: [originRef.current.lon, originRef.current.lat], zoom: 14.4, minZoom: 9, maxZoom: 18, interactive, attributionControl: false, renderWorldCopies: false });
        map.current = instance;
        // Custom styles can carry other providers' required credits in their sources.
        if (customStyle) instance.addControl(new libre.AttributionControl({ compact: false }), 'bottom-right');
        const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { if (!disposed) setView(v => v + 1); }); };
        instance.on('move', update);
        instance.on('resize', update);
        instance.on('load', () => { if (!disposed) { clearTimeout(watchdog); setStatus('ready'); setGeneration(value => value + 1); update(); } });
        instance.on('error', () => { if (!disposed && !instance.isStyleLoaded()) setStatus('unavailable'); });
        instance.on('idle', () => { if (!disposed && instance.isStyleLoaded() && instance.areTilesLoaded()) setStatus('ready'); });
        if (editing) instance.on('click', event => {
          if (event.lngLat.lat >= 41.6 && event.lngLat.lat <= 42.1 && event.lngLat.lng >= -88 && event.lngLat.lng <= -87.45) onChange.current?.({ lat: event.lngLat.lat, lon: event.lngLat.lng });
        });
        resize = new ResizeObserver(() => { instance.resize(); if (!editing) fitRef.current(); }); resize.observe(container.current);
      } catch { if (!disposed) setStatus('unavailable'); }
    }).catch(() => { if (!disposed) setStatus('unavailable'); });
    return () => { disposed = true; clearTimeout(watchdog); cancelAnimationFrame(frame); resize?.disconnect(); map.current?.remove(); map.current = null; };
  }, [key, customStyle, theme, interactive, editing, attempt]);

  function fit(allStops = false) {
    const instance = map.current;
    if (!instance) return;
    if (editing) { instance.jumpTo({ center: [origin.lon, origin.lat] }); return; }
    const nearby = [...places, ...visibleVehicles].filter(point => allStops || distanceMeters(origin, point) <= 2000);
    if (!nearby.length) { instance.jumpTo({ center: [origin.lon, origin.lat], zoom: 14.4 }); return; }
    const points = [origin, ...nearby];
    instance.fitBounds([[Math.min(...points.map(p => p.lon)), Math.min(...points.map(p => p.lat))], [Math.max(...points.map(p => p.lon)), Math.max(...points.map(p => p.lat))]], { padding: { top: 110, bottom: 120, left: 90, right: 90 }, maxZoom: 15.4, duration: 0 });
  }
  fitRef.current = fit;
  useEffect(() => { fit(); }, [cameraKey, generation]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !routes || !instance.isStyleLoaded() || editing) return;
    if (!instance.getSource('transit-routes')) instance.addSource('transit-routes', { type: 'geojson', data: routes });
    for (const kind of ['bus', 'rail', 'metra'] as const) {
      const id = `transit-${kind}`;
      if (!instance.getLayer(id)) {
        instance.addLayer({ id, type: 'line', source: 'transit-routes', filter: ['==', ['get', 'kind'], kind], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': kind === 'bus' ? 2 : 4, 'line-opacity': kind === 'bus' ? .55 : .9, ...(kind === 'metra' ? { 'line-dasharray': [3, 1.5] } : {}) } });
      }
      instance.setLayoutProperty(id, 'visibility', layers[kind] ? 'visible' : 'none');
    }
  }, [routes, generation, layers]);

  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      setSizes(previous => {
        const next = { ...previous }; let changed = false;
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.placeId!;
          const height = Math.ceil(entry.borderBoxSize[0]?.blockSize ?? entry.target.getBoundingClientRect().height);
          if (height && next[id] !== height) { next[id] = height; changed = true; }
        }
        return changed ? next : previous;
      });
    });
    labelElements.current.forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, [generation, fitKey, selected, sizes]);

  const instance = map.current;
  const width = container.current?.clientWidth ?? 0;
  const height = container.current?.clientHeight ?? 0;
  const labelWidth = width < 400 ? 180 : width > 1100 ? 280 : 224;
  const labels = useMemo(() => {
    if (!instance || editing) return [];
    return placeMapLabels(places.map(place => {
      const point = instance.project([place.lon, place.lat]);
      return { id: place.id, x: point.x, y: point.y, width: labelWidth, height: sizes[place.id] ?? 136 };
    }).filter(p => p.x >= 0 && p.x <= width && p.y >= 55 && p.y <= height - 30), width, height,
      [...visibleVehicles, origin].map(point => ({ ...instance.project([point.lon, point.lat]), radius: 20 })).concat([74, 118, 162].map(offset => ({ x: width - 32, y: height - offset, radius: 24 }))));
  }, [instance, editing, places, sizes, width, height, labelWidth, view, vehiclePositionsKey]);
  const selectedPlace = places.find(place => place.id === selected);
  const originPoint = instance?.project([origin.lon, origin.lat]);

  return <div className={`mobility-map-container map-${theme}`}>
    <div className="mobility-map-canvas" ref={container} aria-label={editing ? 'Interactive neighborhood map. Click to set your entrance; coordinate inputs are also available.' : 'Map of selected neighborhood mobility options'} />
    {status === 'ready' && <>
      {!editing && <div className="map-layer-controls" aria-label="Map route layers">{(Object.keys(layerNames) as (keyof typeof layers)[]).map(kind => <button key={kind} type="button" aria-pressed={layers[kind]} onClick={() => setLayers(value => ({ ...value, [kind]: !value[kind] }))}><i className={`layer-line layer-${kind}`} aria-hidden="true" />{layerNames[kind]}</button>)}</div>}
      <svg className="map-leaders" aria-hidden="true">{labels.map(label => <g key={label.id}><line x1={label.x} y1={label.y} x2={Math.max(label.left, Math.min(label.left + label.width, label.x))} y2={Math.max(label.top, Math.min(label.top + label.height, label.y))} /><circle cx={label.x} cy={label.y} r="5" /></g>)}</svg>
      {labels.map(label => {
        const place = places.find(p => p.id === label.id)!;
        const card = mergedCards.get(label.id);
        return <button type="button" key={label.id} className={`map-stop-label${label.compact ? ' compact-label' : ''}`} style={{ left: label.left, top: label.top, width: label.compact ? 44 : labelWidth }} data-place-id={label.id} ref={element => { if (element && !label.compact) labelElements.current.set(label.id, element); else labelElements.current.delete(label.id); }} aria-label={`${place.name}. ${label.compact ? 'Show details' : 'Show stop details'}`} aria-expanded={selected === label.id} onClick={event => { selectedTrigger.current = event.currentTarget; setSelected(selected === label.id ? undefined : label.id); }}>
          <span className="map-stop-heading"><OperatorLabel provider={place.provider_id} />{!label.compact && <strong>{place.name}</strong>}</span>
          {!label.compact && <>{card && <MapCardInfo card={card} now={now} online={online} timeFormat={timeFormat} />}{mode === 'demo' && <small className="map-sample-label">Demo data</small>}</>}
        </button>;
      })}
      {visibleVehicles.map(vehicle => {
        const p = instance?.project([vehicle.lon, vehicle.lat]);
        if (!p || p.x < 20 || p.x > width - 20 || p.y < 60 || p.y > height - 60) return null;
        return <span key={vehicle.id} className="map-vehicle" style={{ left: p.x, top: p.y }} role="img" aria-label={`Undocked Divvy ${vehicle.type === 'electric' ? 'e-bike' : vehicle.type}, ${vehicle.location_label || 'approximate location'}`} title={`Divvy ${vehicle.type === 'electric' ? 'e-bike' : vehicle.type} · ${vehicle.location_label || 'Approximate location'}`}><Bike size={18} /><span>{vehicle.type === 'electric' ? <Zap size={10} /> : 'P'}</span></span>;
      })}
      {originPoint && <span className="map-origin" style={{ left: originPoint.x, top: originPoint.y }} role="img" aria-label="Board location" title="Board location" />}
      <div className="map-navigation" aria-label="Map navigation"><button aria-label="Zoom in" onClick={() => instance?.zoomIn({ duration: reducedMotion() ? 0 : 150 })}><Plus size={18} /></button><button aria-label="Zoom out" onClick={() => instance?.zoomOut({ duration: reducedMotion() ? 0 : 150 })}><Minus size={18} /></button><button aria-label={editing ? 'Center on pin' : 'Fit all stops'} onClick={() => fit(true)}><LocateFixed size={18} /></button></div>
      {selectedPlace && <section className="map-selected-detail" aria-label={`${selectedPlace.name} details`} onKeyDown={event => { if (event.key === 'Escape') closeDetail(); }}><header><OperatorLabel provider={selectedPlace.provider_id} /><strong>{selectedPlace.name}</strong><button ref={detailClose} aria-label="Close stop details" onClick={closeDetail}><X size={18} /></button></header>{mergedCards.has(selectedPlace.id) ? <MapCardInfo card={mergedCards.get(selectedPlace.id)!} now={now} online={online} timeFormat={timeFormat} /> : <span>{selectedPlace.routes.join(' · ')}</span>}{mode === 'demo' && <small>Demo data</small>}</section>}
      {!editing && <div className="map-bottom-note">{routesError ? <><span>Route lines unavailable</span><button onClick={() => setAttempt(v => v + 1)}>Retry</button></> : <span>Route paths{routes ? ` · ${new Date(routes.imported_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ' loading…'} · may exclude detours</span>}</div>}
    </>}
    {status !== 'ready' && <div className="map-state" role="status"><LocateFixed size={30} /><strong>{status === 'loading' ? 'Loading map…' : 'Map unavailable'}</strong><p>{status === 'loading' ? 'Loading streets and transit routes.' : 'Use the mobility list for stops, arrivals, and bike availability.'}</p>{status === 'unavailable' && (key || customStyle) && <button type="button" className="map-retry" onClick={() => setAttempt(value => value + 1)}>Retry map</button>}</div>}
    <div className="map-attribution">{!customStyle && <><a href="https://protomaps.com" target="_blank" rel="noreferrer">Protomaps</a><span>· ©</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a><span>·</span><a href="/data-notices.html#map-credits" target="_blank" rel="noreferrer">Map credits</a><span>· </span></>}<span>CTA</span><span className="metra-map-notice">{metraDisclaimer}{routes && ` Routes updated ${routes.imported_at.slice(0, 10)}.`}{places.some(place => place.provider_id === 'metra') && ` Stations: ${mode === 'demo' ? 'sample data' : stationDataDate(catalogVersion)}.`}</span></div>
  </div>;
}
