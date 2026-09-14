import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowDownLeft, ArrowUpRight, ArrowRight, Bike, Bus, Check, ChevronLeft,
  ChevronRight, CircleHelp, Clock3, Expand, LocateFixed, MapPin, Minimize,
  Radio, RefreshCw, Settings2, TrainFront, TramFront, TriangleAlert, WifiOff, Zap,
} from 'lucide-react';
import MobilityMap from './components/MobilityMap';
import SetupPanel from './components/SetupPanel';
import { useBoard } from './lib/useBoard';
import { formatClock, formatDistance, formatEvent, distanceMeters } from './lib/format';
import type { BoardCard, BoardConfig, PlaceKind, TransitEvent } from './lib/types';
import './styles.css';

const categoryNames: Record<PlaceKind | 'vehicles', string> = {
  rail_station: 'CTA TRAIN', bus_stop: 'CTA BUS', metra_station: 'METRA',
  shared_station: 'DIVVY STATION', vehicles: 'NEARBY E-BIKES',
};

function CategoryIcon({ kind, size = 19 }: { kind: BoardCard['kind']; size?: number }) {
  if (kind === 'bus_stop') return <Bus size={size} />;
  if (kind === 'rail_station') return <TramFront size={size} />;
  if (kind === 'metra_station') return <TrainFront size={size} />;
  return <Bike size={size} />;
}

function routeColor(route: string, color?: string) {
  if (color && /^#?[a-f\d]{6}$/i.test(color)) return color.startsWith('#') ? color : `#${color}`;
  const colors: Record<string, string> = { Brn: '#a88463', Brown: '#a88463', P: '#b99cdd', Purple: '#b99cdd', Red: '#ef747a', Blue: '#70a6ef', G: '#65b99a', Green: '#65b99a', Pink: '#e498c4', Orange: '#eba76a', Yellow: '#e7d273' };
  return colors[route] ?? '#8eb7cd';
}

function ArrivalTime({ event, now, timeFormat }: { event: TransitEvent; now: number; timeFormat: '12h' | '24h' }) {
  const fullValue = formatEvent(event, now, timeFormat);
  const value = event.time_basis === 'schedule' ? fullValue.replace(/^Scheduled\s*[·:]\s*/, '') : fullValue;
  const parts = /^(\d+)\s*(min|mins)$/i.exec(value);
  return <div aria-label={fullValue} className={`arrival-time ${event.approaching ? 'approaching' : ''} ${event.status !== 'normal' ? 'event-exception' : ''}`}>
    {parts ? <><strong>{parts[1]}</strong><span>min</span></> : <strong className="time-word">{value}</strong>}
  </div>;
}

function MobilityCard({ card, index, config, now, online, mode, onConfigure }: {
  card: BoardCard; index: number; config: BoardConfig; now: number; online: boolean;
  mode: 'demo' | 'live'; onConfigure: () => void;
}) {
  const expiresAt = card.freshness ? Date.parse(card.freshness.expires_at) : Infinity;
  const expired = expiresAt <= now;
  const stale = !online || card.state === 'stale' || card.freshness?.state === 'stale' || (!!card.freshness && Date.parse(card.freshness.stale_at) <= now);
  const unavailable = expired || ['unavailable', 'not_connected', 'removed', 'loading'].includes(card.state);
  const freshEvents = card.events.filter(event => {
    if (Date.parse(event.freshness.expires_at) <= now) return false;
    const time = event.expected_at ?? event.scheduled_at;
    return !time || Date.parse(time) >= now - 30_000;
  });
  const freshVehicles = !online || expired || stale || (card.freshness && card.freshness.state !== 'fresh') ? [] : card.vehicles.filter(vehicle => Date.parse(vehicle.freshness.expires_at) > now && Date.parse(vehicle.freshness.stale_at) > now && vehicle.freshness.state === 'fresh');
  const availability = !unavailable ? card.availability : undefined;
  const approxDistance = card.place ? formatDistance(distanceMeters(config.origin, card.place)) : null;
  const isScooter = card.kind === 'vehicles' && (card.title.toLowerCase().includes('scooter') || config.vehicle_rules.find(rule => rule.id === card.id)?.type === 'scooter');
  const category = isScooter ? 'NEARBY SCOOTERS' : categoryNames[card.kind];
  const emptyHeading = expired ? 'Waiting for fresh data' : card.state === 'not_connected' ? 'Provider not connected' : card.state === 'removed' ? 'Choose a replacement' : card.state === 'loading' ? 'Finding the latest…' : card.kind === 'shared_station' ? 'Station unavailable' : 'Feed unavailable';
  const isShared = card.kind === 'shared_station';
  const rentalsClosed = availability?.rental_state === 'unavailable';
  const knownBikeTotal = availability?.classic != null && availability?.electric != null ? availability.classic + availability.electric : null;

  return <article className={`mobility-card kind-${card.kind}${stale && !unavailable ? ' is-stale' : ''}`} aria-label={`${card.title}, ${category.toLowerCase()}`}>
    <div className="card-topline">
      <span className="category-label"><CategoryIcon kind={card.kind} />{category}</span>
      <span className="map-index" aria-label={`Map marker ${index + 1}`}>{String(index + 1).padStart(2, '0')}</span>
    </div>
    <div className="card-heading"><h2 title={card.title}>{card.title}</h2>{approxDistance && <span className="card-distance" title="Approximate straight-line distance"><MapPin size={12} />{approxDistance}</span>}</div>
    <div className="card-subtitle">{card.subtitle || (card.kind === 'vehicles' ? 'Available now, near your location' : 'Upcoming service')}</div>

    {unavailable ? <div className="card-empty">
      {card.state === 'loading' ? <RefreshCw size={23} className="spin" /> : card.state === 'not_connected' ? <Radio size={23} /> : <TriangleAlert size={23} />}
      <div><strong>{emptyHeading}</strong><p>{expired ? 'Last snapshot expired. Reconnecting automatically.' : card.message || 'Please check back in a moment.'}</p></div>
      {(card.state === 'removed' || card.state === 'not_connected') && <button className="text-button" onClick={onConfigure} aria-label={`Configure ${card.title}`}><ArrowUpRight size={18} /></button>}
    </div> : isShared && rentalsClosed ? <div className="inline-empty"><Bike size={25} /><span>Rentals currently closed<small>This station is not available for pickup.</small></span></div> : isShared ? <>
      <div className="availability-counts" aria-label="Available vehicles">
        <div><span><Bike size={17} />Classic</span><strong>{availability?.classic ?? '—'}</strong></div>
        <div className="electric-count"><span><Zap size={16} />E-bikes</span><strong>{availability?.electric ?? '—'}</strong></div>
        {availability?.scooters != null && <div><span>Scooters</span><strong>{availability.scooters}</strong></div>}
      </div>
      <div className="station-detail"><span className={`status-dot ${availability?.rental_state === 'available' ? 'green' : 'muted'}`} />{availability?.rental_state === 'available' ? knownBikeTotal === 0 ? 'No bikes available right now' : knownBikeTotal !== null && knownBikeTotal > 0 ? 'Bikes available to rent' : 'Station open for rentals' : 'Rental status unknown'}{availability?.docks != null && <span className="docks-count">{availability.docks} open docks</span>}</div>
    </> : card.kind === 'vehicles' ? <div className="vehicle-list">
      {freshVehicles.length ? freshVehicles.map((vehicle, vehicleIndex) => <div className="vehicle-row" key={vehicle.id}>
        <span className="vehicle-pin"><Zap size={15} /></span>
        <span className="vehicle-info"><strong>{vehicle.location_label || `${isScooter ? 'Scooter' : 'E-bike'} ${vehicleIndex + 1}`}</strong><small>Approximate location · pin {index + 1}.{card.vehicles.findIndex(item => item.id === vehicle.id) + 1}</small></span>
        <strong className="vehicle-distance">{formatDistance(vehicle.distance_m)}</strong>
      </div>) : <div className="inline-empty"><Bike size={24} /><span>{!online ? 'Availability hidden while offline' : stale ? 'Waiting for fresh availability' : 'No vehicles reported nearby'}<small>{card.message || 'This search updates automatically.'}</small></span></div>}
    </div> : <div className="arrival-list">
      {freshEvents.length ? freshEvents.map(event => <div className="arrival-row" key={event.id}>
        <span className="route-pill" style={{ '--route-color': routeColor(event.route, event.color) } as CSSProperties}>{event.route}</span>
        <div className="arrival-destination"><strong>{event.destination}</strong>{event.time_basis === 'schedule' ? <small><Clock3 size={10} />Scheduled</small> : event.status === 'delayed' ? <small>Service delayed</small> : null}</div>
        <ArrivalTime event={event} now={now} timeFormat={config.preferences.time_format} />
      </div>) : <div className="inline-empty"><Clock3 size={23} /><span>No live predictions<small>{card.message || 'Check provider schedules for other service.'}</small></span></div>}
    </div>}

    <div className="card-footer"><span className={`status-dot ${mode === 'demo' ? 'amber' : unavailable ? 'muted' : stale ? 'amber' : 'green'}`} />
      {mode === 'demo' ? 'DEMO DATA' : unavailable ? 'UNAVAILABLE' : stale ? 'STALE DATA' : card.kind === 'vehicles' || isShared ? 'LIVE AVAILABILITY' : freshEvents.length && freshEvents.every(event => event.time_basis === 'schedule') ? 'SCHEDULED' : 'LIVE PREDICTIONS'}
      {config.preferences.show_alerts && card.alerts.length > 0 && <span className="card-alert" title={card.alerts.join(' · ')}><TriangleAlert size={12} />{card.alerts[0]}</span>}
      {card.kind === 'vehicles' && <span className="card-footer-note">Rent in the Divvy app <ArrowUpRight size={12} /></span>}
    </div>
  </article>;
}

function useViewport() {
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const update = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return viewport;
}

export default function App() {
  const { config, setConfig, board, catalog, providers, loading, error, online, refresh, mode, setMode } = useBoard();
  const [now, setNow] = useState(Date.now());
  const [setupOpen, setSetupOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [kiosk, setKiosk] = useState(false);
  const [notice, setNotice] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);
  const closeAbout = useCallback(() => setInfoOpen(false), []);
  const viewport = useViewport();
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  const portrait = config.preferences.orientation === 'portrait' || (config.preferences.orientation === 'auto' && viewport.height > viewport.width);
  const maximumEntries = Math.max(1, ...config.selections.map(selection => selection.limit), ...config.vehicle_rules.map(rule => rule.limit));
  const needsRoom = config.preferences.text_scale > 1.1 || maximumEntries > 3;
  const compactLandscape = !portrait && viewport.width > 760 && (viewport.height < 800 || (viewport.width < 1680 && (viewport.height < 960 || (needsRoom && viewport.height < 1100))));
  const ordinaryPageSize = compactLandscape ? needsRoom && viewport.height < 780 ? 2 : 4 : 6;
  const kioskPageSize = portrait ? needsRoom ? 4 : 6 : maximumEntries > 3 ? 2 : 4;
  const pageSize = kiosk && viewport.width > 760 ? kioskPageSize : ordinaryPageSize;
  const cards = board?.cards ?? [];
  const totalPages = Math.max(1, Math.ceil(cards.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const visibleCards = useMemo(() => cards.slice(safePage * pageSize, (safePage + 1) * pageSize), [cards, safePage, pageSize]);
  const places = useMemo(() => visibleCards.flatMap(card => card.place ? [card.place] : []), [visibleCards]);
  const placeLabels = visibleCards.flatMap((card, index) => card.place ? [String(safePage * pageSize + index + 1).padStart(2, '0')] : []);
  const mappedVehicles = online ? visibleCards.flatMap((card, cardIndex) => card.state === 'stale' || (card.freshness && (card.freshness.state !== 'fresh' || Date.parse(card.freshness.stale_at) <= now)) ? [] : card.vehicles.map((vehicle, vehicleIndex) => ({ vehicle, label: `${safePage * pageSize + cardIndex + 1}.${vehicleIndex + 1}` }))).filter(({ vehicle }) => Date.parse(vehicle.freshness.expires_at) > now && Date.parse(vehicle.freshness.stale_at) > now && vehicle.freshness.state === 'fresh') : [];
  const vehicles = mappedVehicles.map(item => item.vehicle);
  const vehicleLabels = mappedVehicles.map(item => item.label);
  const chicagoDate = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'long', month: 'long', day: 'numeric' }).format(now);
  const shortDate = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric' }).format(now);
  const clock = formatClock(now, config.preferences.time_format);
  const clockParts = /^(.*)\s(AM|PM)$/.exec(clock);
  const refreshAge = board ? Math.max(0, Math.floor((now - Date.parse(board.server_time)) / 1000)) : 0;
  const connectionText = !online ? 'Offline · data may be out of date' : error ? 'Connection interrupted · retrying' : mode === 'demo' ? 'Preview with sample data' : loading && !board ? 'Connecting to live feeds' : 'Connected to your board';

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (totalPages <= 1 || setupOpen || infoOpen) return;
    const timer = window.setInterval(() => setPage(current => (current + 1) % totalPages), 25_000);
    return () => window.clearInterval(timer);
  }, [totalPages, setupOpen, infoOpen]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 6000); return () => window.clearTimeout(timer); }, [notice]);
  useEffect(() => {
    document.documentElement.dataset.theme = config.preferences.theme;
    document.title = `${config.label || 'Your neighborhood'} · Near & Next`;
  }, [config.label, config.preferences.theme]);
  useEffect(() => {
    if (!kiosk) return;
    let active = true;
    const acquire = async () => {
      if (document.visibilityState !== 'visible') return;
      const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } };
      try { const lock = await nav.wakeLock?.request('screen'); if (lock && active) wakeLock.current = lock; else if (lock) await lock.release(); } catch { /* Browser power policy may decline a wake lock. */ }
    };
    void acquire();
    const fullscreenChanged = () => { if (!document.fullscreenElement) setKiosk(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setKiosk(false); };
    document.addEventListener('visibilitychange', acquire);
    document.addEventListener('fullscreenchange', fullscreenChanged);
    document.addEventListener('keydown', escape);
    return () => {
      active = false;
      void wakeLock.current?.release(); wakeLock.current = null;
      document.removeEventListener('visibilitychange', acquire);
      document.removeEventListener('fullscreenchange', fullscreenChanged);
      document.removeEventListener('keydown', escape);
    };
  }, [kiosk]);

  async function toggleKiosk() {
    if (kiosk) { setKiosk(false); if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined); return; }
    setSetupOpen(false); setKiosk(true);
    try { if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); else setNotice('Display mode is on. Your browser does not support fullscreen.'); }
    catch { setNotice('Display mode is on. Use your browser’s fullscreen control to fill the screen.'); }
  }

  return <div className={`app-shell${kiosk ? ' kiosk-mode' : ''}${portrait ? ' portrait-layout' : ''}${!config.preferences.show_map ? ' map-hidden' : ''}`} style={{ '--text-scale': config.preferences.text_scale } as CSSProperties}>
    <a className="skip-link" href="#mobility-board">Skip to mobility board</a>
    <header className="app-header">
      <a href="#" className="brand" aria-label="Near and Next home" onClick={event => event.preventDefault()}>
        <span className="brand-mark" aria-hidden="true"><ArrowUpRight /><ArrowDownLeft /></span>
        <span className="brand-name">near<span className="brand-amp">&</span>next<span className="brand-tagline">CHICAGO, WITHIN REACH.</span></span>
      </a>
      <div className="header-actions">
        <div className="mode-control"><span className={`status-dot ${mode === 'demo' ? 'amber' : online && !error ? 'green' : 'muted'}`} /><select aria-label="Data mode" value={mode} onChange={event => { setMode(event.target.value as 'demo' | 'live'); setPage(0); }}><option value="demo">Demo board</option><option value="live">Live board</option></select><ChevronRight size={13} className="select-chevron" /></div>
        <span className="header-divider" />
        {!kiosk && <button aria-label="Customize" className="header-button setup-trigger" onClick={() => setSetupOpen(true)}><Settings2 size={17} /><span>Customize</span></button>}
        <button aria-label={kiosk ? 'Exit display' : 'Display mode'} className="header-button display-trigger" onClick={() => void toggleKiosk()}>{kiosk ? <Minimize size={17} /> : <Expand size={17} />}<span>{kiosk ? 'Exit display' : 'Display mode'}</span></button>
      </div>
    </header>

    <main id="mobility-board" tabIndex={-1} className="main-content">
      <section className="board-intro" aria-label="Board location and local time">
        <div className="intro-copy"><div className="location-eyebrow"><span className="status-dot amber" /><span>{config.label || 'Your neighborhood'}</span><span className="eyebrow-separator">/</span><span>CHICAGO</span></div><h1>Your next move<span>.</span></h1><p>Good things are just around the corner.</p></div>
        <div className="board-clock"><time dateTime={new Date(now).toISOString()}><span>{clockParts ? clockParts[1] : clock}</span>{clockParts && <small>{clockParts[2]}</small>}</time><span className="clock-date"><span className="full-date">{chicagoDate}</span><span className="short-date">{shortDate}</span><span className="timezone-label">CT</span></span></div>
      </section>

      {(!online || error) && <div className="connection-banner" role="status"><WifiOff size={17} /><span>{!online ? 'You’re offline. Saved settings are safe; old availability will expire automatically.' : error}</span><button className="text-button" onClick={refresh} disabled={!online}>Try again <RefreshCw size={14} /></button></div>}

      <div className="dashboard-layout">
        <section className="board-section" aria-label="Pinned stops and mobility options">
          <div className="section-heading"><h2><span className="section-rule" />THE NEIGHBORHOOD BOARD</h2><span className="section-caption">{cards.length} {cards.length === 1 ? 'connection' : 'connections'} nearby</span></div>
          {loading && !cards.length ? <div className="board-loading"><RefreshCw className="spin" size={28} /><h2>Getting your board ready</h2><p>Connecting your neighborhood’s next arrivals.</p></div> : !cards.length ? <div className="board-loading"><MapPin size={33} /><h2>Your neighborhood starts here.</h2><p>Pin a stop, a station, or nearby bikes to build your board.</p><button className="primary-button" onClick={() => setSetupOpen(true)}>Customize your board <ArrowRight size={17} /></button></div> : <div className={`cards-grid card-count-${visibleCards.length}`}>
            {visibleCards.map((card, index) => <MobilityCard key={card.id} card={card} index={safePage * pageSize + index} config={config} now={now} online={online} mode={mode} onConfigure={() => setSetupOpen(true)} />)}
            {visibleCards.length === 5 && !kiosk && <div className="add-connection-card"><span className="add-connection-mark"><ArrowUpRight size={29} /></span><h2>Make room for<br />one more possibility.</h2><p>Your favorite stop. A different line.<br />A new way home.</p><button className="text-button" onClick={() => setSetupOpen(true)}>Add a connection <ArrowRight size={16} /></button></div>}
          </div>}
          {totalPages > 1 && <nav className="board-pagination" aria-label="Board pages"><span>More ways to get there</span><div><button aria-label="Previous board page" onClick={() => setPage((safePage - 1 + totalPages) % totalPages)}><ChevronLeft size={16} /></button>{Array.from({ length: totalPages }, (_, index) => <button key={index} className={`page-dot${safePage === index ? ' active' : ''}`} aria-label={`Board page ${index + 1}`} aria-current={safePage === index ? 'page' : undefined} onClick={() => setPage(index)} />)}<button aria-label="Next board page" onClick={() => setPage((safePage + 1) % totalPages)}><ChevronRight size={16} /></button></div><span>{safePage + 1} / {totalPages} · rotates every 25s</span></nav>}
        </section>

        {config.preferences.show_map && <aside className="map-section" aria-label="Map of selected stops and vehicles"><div className="section-heading"><h2><span className="section-rule" />RIGHT AROUND HERE</h2><LocateFixed size={15} /></div><div className="neighborhood-map"><MobilityMap origin={config.origin} places={places} vehicles={vehicles} placeLabels={placeLabels} vehicleLabels={vehicleLabels} theme={config.preferences.theme} /><div className="map-caption"><span className="map-origin-symbol"><LocateFixed size={16} /></span><div><strong>You are here</strong><span>{config.label || 'Your board location'}</span></div><span className="map-radius-label">CHICAGO</span></div></div><div className="map-notes"><div><MapPin size={15} /><span>Small distance. More possibilities.</span></div><p>Distances are approximate, measured in a straight line. Your route may be a little different.</p></div><div className="map-key"><span><i className="legend-stop" />Pinned stop</span><span><i className="legend-bike" />Shared mobility</span><span><i className="legend-origin" />Your location</span></div></aside>}
      </div>
    </main>

    <footer className="app-footer"><div className="freshness-status" role="status" aria-live="polite"><span className={`status-dot ${!online || error ? 'amber' : mode === 'demo' ? 'amber' : 'green'}`} />{connectionText}</div><div className="footer-center">{mode === 'demo' ? 'Sample arrivals & availability · not for trip planning' : 'Times are estimates. Check the operator for service changes.'}</div><div className="footer-actions"><button onClick={refresh} aria-label="Refresh board" className={`refresh-button${loading ? ' is-refreshing' : ''}`} disabled={loading || !online}><RefreshCw size={12} /><span>{loading ? 'Refreshing' : board ? `Updated ${refreshAge < 5 ? 'just now' : `${refreshAge}s ago`}` : 'Refresh'}</span></button><button className="attribution-button" onClick={() => setInfoOpen(true)} aria-label="Data sources and about"><CircleHelp size={13} /><span>Sources & about</span></button></div></footer>

    {setupOpen && <SetupPanel config={config} setConfig={setConfig} catalog={catalog} providers={providers} mode={mode} setMode={setMode} onClose={() => setSetupOpen(false)} onDisplay={() => void toggleKiosk()} />}
    {infoOpen && <AboutDialog onClose={closeAbout} attributions={board?.attributions ?? []} mode={mode} />}
    {notice && <div className="toast" role="status"><Check size={18} />{notice}</div>}
  </div>;
}

function AboutDialog({ onClose, attributions, mode }: { onClose: () => void; attributions: string[]; mode: 'demo' | 'live' }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); if (event.key === 'Tab') { event.preventDefault(); closeRef.current?.focus(); } };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [onClose]);
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title"><span className="dialog-eyebrow">A LITTLE LOCAL KNOWLEDGE</span><h2 id="about-title">Near & Next</h2><p>An open-source neighborhood mobility board for Chicago. No account required. Your configuration stays in this browser.</p>{mode === 'demo' && <div className="notice-box"><TriangleAlert size={18} /><span>You’re viewing a demonstration. All arrivals and vehicle availability on this board are sample data.</span></div>}<h3>Data & mapping</h3><p>{attributions.length ? attributions.join(' · ') : 'CTA transit data and Divvy shared mobility, when connected. Protomaps cartography with OpenStreetMap contributors.'}</p><p>Not affiliated with or endorsed by CTA, Metra, Divvy, or the City of Chicago. Provider data and map tiles remain subject to their own terms. Metra and restricted scooter providers require further integration before live service.</p><button ref={closeRef} className="primary-button" onClick={onClose}>Back to the board <ArrowRight size={17} /></button></section></div>;
}
