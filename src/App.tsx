import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Pause, Play, ArrowUpRight, ArrowRight, Bike, Check, ChevronLeft,
  ChevronRight, CircleHelp, Clock3, Expand, MapPin, Minimize,
  Radio, RefreshCw, Settings2, TriangleAlert, WifiOff, Zap,
} from 'lucide-react';
import OperatorLogo from './components/OperatorLogo';
import Departures from './components/Departures';
import { availableVehicles, cardState, departureGroups } from './lib/presentation';
import MobilityMap from './components/MobilityMap';
import SetupPanel from './components/SetupPanel';
import { useBoard } from './lib/useBoard';
import { formatClock, formatDistance, distanceMeters } from './lib/format';
import type { BoardCard, BoardConfig, PlaceKind } from './lib/types';
import './styles.css';

const categoryNames: Record<PlaceKind | 'vehicles', string> = {
  rail_station: 'CTA TRAIN', bus_stop: 'CTA BUS', metra_station: 'METRA',
  shared_station: 'DIVVY STATION', vehicles: 'NEARBY E-BIKES',
};

function MobilityCard({ card, config, now, online, mode, onConfigure }: {
  card: BoardCard; config: BoardConfig; now: number; online: boolean;
  mode: 'demo' | 'live'; onConfigure: () => void;
}) {
  const expiresAt = card.freshness ? Date.parse(card.freshness.expires_at) : Infinity;
  const expired = expiresAt <= now;
  const stale = !online || card.state === 'stale' || card.freshness?.state === 'stale' || (!!card.freshness && Date.parse(card.freshness.stale_at) <= now);
  const unavailable = cardState(card, now, online) === 'unavailable';
  const arrivalLimit = config.selections.find(selection => selection.id === card.id)?.limit ?? 2;
  const freshEvents = departureGroups(card.events, now, arrivalLimit).flatMap(group => group.events);
  const freshVehicles = availableVehicles(card, now, online);
  const availability = !unavailable ? card.availability : undefined;
  const approxDistance = card.place ? formatDistance(distanceMeters(config.origin, card.place)) : null;
  const isScooter = card.kind === 'vehicles' && (card.title.toLowerCase().includes('scooter') || config.vehicle_rules.find(rule => rule.id === card.id)?.type === 'scooter');
  const category = isScooter ? 'NEARBY SCOOTERS' : categoryNames[card.kind];
  const emptyHeading = expired ? 'Waiting for fresh data' : card.state === 'not_connected' ? 'Provider not connected' : card.state === 'removed' ? 'Choose a replacement' : card.state === 'loading' ? 'Finding the latest…' : card.kind === 'shared_station' ? 'Station unavailable' : 'Feed unavailable';
  const isShared = card.kind === 'shared_station';
  const rentalsClosed = availability?.rental_state === 'unavailable';
  const knownBikeTotal = availability?.classic != null && availability?.electric != null ? availability.classic + availability.electric : null;

  return <article className={`mobility-card kind-${card.kind}${stale && !unavailable ? ' is-stale' : ''}`} aria-label={`${card.title}, ${category.toLowerCase()}`}>
    <div className="card-heading"><OperatorLogo provider={card.provider_id} /><h3>{card.title}</h3>{approxDistance && <span className="card-distance" title="Approximate straight-line distance"><MapPin size={12} />{approxDistance}</span>}</div>
    <div className="card-subtitle">{card.subtitle || (card.kind === 'vehicles' ? 'Available now, near your location' : 'Upcoming service')}</div>

    {unavailable ? <div className="card-empty">
      {card.state === 'loading' ? <RefreshCw size={23} className="spin" /> : card.state === 'not_connected' ? <Radio size={23} /> : <TriangleAlert size={23} />}
      <div><strong>{emptyHeading}</strong><p>{expired ? 'Last snapshot expired. Reconnecting automatically.' : card.message || 'Please check back in a moment.'}</p></div>
      {(card.state === 'removed' || card.state === 'not_connected') && <button className="text-button" onClick={onConfigure} aria-label={`Configure ${card.title}`}><ArrowUpRight size={18} /></button>}
    </div> : isShared && rentalsClosed ? <div className="inline-empty"><Bike size={25} /><span>Rentals currently closed<small>This station is not available for pickup.</small></span></div> : isShared ? <>
      <div className="availability-counts" aria-label="Available vehicles">
        <div><span><Bike size={17} />Pedal</span><strong>{availability?.classic ?? '—'}</strong></div>
        <div className="electric-count"><span><Zap size={16} />E-bikes</span><strong>{availability?.electric ?? '—'}</strong></div>
        {availability?.scooters != null && <div><span>Scooters</span><strong>{availability.scooters}</strong></div>}
      </div>
      <div className="station-detail"><span className={`status-dot ${availability?.rental_state === 'available' ? 'green' : 'muted'}`} />{availability?.rental_state === 'available' ? knownBikeTotal === 0 ? 'No bikes available right now' : knownBikeTotal !== null && knownBikeTotal > 0 ? 'Bikes available to rent' : 'Station open for rentals' : 'Rental status unknown'}{availability?.docks != null && <span className="docks-count">{availability.docks} open docks</span>}</div>
    </> : card.kind === 'vehicles' ? <div className="vehicle-list">
      {freshVehicles.length ? freshVehicles.map((vehicle, vehicleIndex) => <div className="vehicle-row" key={vehicle.id}>
        <span className="vehicle-pin"><Zap size={15} /></span>
        <span className="vehicle-info"><strong>{vehicle.location_label || `${isScooter ? 'Scooter' : 'E-bike'} ${vehicleIndex + 1}`}</strong><small>Approximate location</small></span>
        <strong className="vehicle-distance">{formatDistance(vehicle.distance_m)}</strong>
      </div>) : <div className="inline-empty"><Bike size={24} /><span>{!online ? 'Availability hidden while offline' : stale ? 'Waiting for fresh availability' : 'No vehicles reported nearby'}<small>{card.message || 'This search updates automatically.'}</small></span></div>}
    </div> : freshEvents.length ? <Departures events={freshEvents} now={now} timeFormat={config.preferences.time_format} limit={arrivalLimit} /> : <div className="inline-empty"><Clock3 size={23} /><span>No live predictions<small>{card.message || 'Check provider schedules for other service.'}</small></span></div>}


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
  const [rotating, setRotating] = useState(false);
  const [kiosk, setKiosk] = useState(false);
  const [notice, setNotice] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);
  const modalTrigger = useRef<HTMLElement | null>(null);
  const openSetup = () => { modalTrigger.current = document.activeElement as HTMLElement; setSetupOpen(true); };
  const closeSetup = useCallback(() => { setSetupOpen(false); requestAnimationFrame(() => modalTrigger.current?.focus()); }, []);
  const closeAbout = useCallback(() => { setInfoOpen(false); requestAnimationFrame(() => modalTrigger.current?.focus()); }, []);
  const viewport = useViewport();
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  const portrait = config.preferences.orientation === 'portrait' || (config.preferences.orientation === 'auto' && viewport.height > viewport.width);
  const maximumEntries = Math.max(2, ...config.selections.map(selection => selection.limit), ...config.vehicle_rules.map(rule => rule.limit));
  const needsRoom = config.preferences.text_scale > 1.1 || maximumEntries > 3;
  const pageSize = viewport.width < 960 ? 12 : kiosk && needsRoom ? 2 : viewport.height < 800 ? 3 : 6;
  const cards = board?.cards ?? [];
  const totalPages = Math.max(1, Math.ceil(cards.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const visibleCards = useMemo(() => cards.slice(safePage * pageSize, (safePage + 1) * pageSize), [cards, safePage, pageSize]);
  const places = useMemo(() => [...new Map(cards.flatMap(card => card.place ? [[card.place.id, card.place] as const] : [])).values()], [cards]);
  const vehicles = cards.flatMap(card => availableVehicles(card, now, online));
  const chicagoDate = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'long', month: 'long', day: 'numeric' }).format(now);
  const shortDate = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric' }).format(now);
  const clock = formatClock(now, config.preferences.time_format);
  const clockParts = /^(.*)\s(AM|PM)$/.exec(clock);
  const refreshAge = board ? Math.max(0, Math.floor((now - Date.parse(board.server_time)) / 1000)) : 0;
  const connectionText = !online ? 'Offline · data may be out of date' : error ? 'Connection interrupted · retrying' : mode === 'demo' ? 'Preview with sample data' : loading && !board ? 'Connecting to live feeds' : 'Connected to your board';

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (totalPages <= 1 || setupOpen || infoOpen || !rotating || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setPage(current => (current + 1) % totalPages), 25_000);
    return () => window.clearInterval(timer);
  }, [totalPages, setupOpen, infoOpen, rotating]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 6000); return () => window.clearTimeout(timer); }, [notice]);
  useEffect(() => {
    document.documentElement.dataset.theme = config.preferences.theme;
    document.title = `${config.label || 'Chicago'} · Transit display`;
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
    setSetupOpen(false); setKiosk(true); setRotating(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    try { if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); else setNotice('Display mode is on. Your browser does not support fullscreen.'); }
    catch { setNotice('Display mode is on. Use your browser’s fullscreen control to fill the screen.'); }
  }

  return <div className={`app-shell${kiosk ? ' kiosk-mode' : ''}${portrait ? ' portrait-layout' : ''}${!config.preferences.show_map ? ' map-hidden' : ''}`} style={{ '--text-scale': config.preferences.text_scale } as CSSProperties}>
    <a inert={setupOpen || infoOpen} className="skip-link" href="#mobility-board">Skip to mobility board</a>
    <header inert={setupOpen || infoOpen} className="app-header">
      <span className="app-title">Chicago transit</span>
      <div className="header-actions">
        <div className="mode-control"><span className={`status-dot ${mode === 'demo' ? 'amber' : online && !error ? 'green' : 'muted'}`} /><select aria-label="Data mode" value={mode} onChange={event => { setMode(event.target.value as 'demo' | 'live'); setPage(0); }}><option value="demo">Demo board</option><option value="live">Live board</option></select><ChevronRight size={13} className="select-chevron" /></div>
        <span className="header-divider" />
        {!kiosk && <button aria-label="Customize" className="header-button setup-trigger" onClick={openSetup}><Settings2 size={17} /><span>Customize</span></button>}
        <button aria-label={kiosk ? 'Exit display' : 'Display mode'} className="header-button display-trigger" onClick={() => void toggleKiosk()}>{kiosk ? <Minimize size={17} /> : <Expand size={17} />}<span>{kiosk ? 'Exit display' : 'Display mode'}</span></button>
      </div>
    </header>

    <main inert={setupOpen || infoOpen} id="mobility-board" tabIndex={-1} className="main-content">
      <section className="board-intro" aria-label="Board location and local time">
        <div className="intro-copy"><h1>{config.label || 'Chicago'}</h1><p><MapPin size={14} aria-hidden="true" />Transit and bikes nearby</p></div>
        <div className="board-clock"><time dateTime={new Date(now).toISOString()}><span>{clockParts ? clockParts[1] : clock}</span>{clockParts && <small>{clockParts[2]}</small>}</time><span className="clock-date"><span className="full-date">{chicagoDate}</span><span className="short-date">{shortDate}</span><span className="timezone-label">CT</span></span></div>
      </section>

      {(!online || error) && <div className="connection-banner" role="status"><WifiOff size={17} /><span>{!online ? 'You’re offline. Saved settings are safe; old availability will expire automatically.' : error}</span><button className="text-button" onClick={refresh} disabled={!online}>Try again <RefreshCw size={14} /></button></div>}

      <div className="dashboard-layout">
        <section className="board-section" aria-label="Pinned stops and mobility options">
          <div className="section-heading"><h2><span className="section-rule" />Mobility options</h2><span className="section-caption">{cards.length} {cards.length === 1 ? 'option' : 'options'}</span></div>
          {loading && !cards.length ? <div className="board-loading"><RefreshCw className="spin" size={28} /><h2>Loading mobility options</h2><p>Fetching arrivals and bike availability.</p></div> : !cards.length ? <div className="board-loading"><MapPin size={33} /><h2>No stops selected</h2><p>Choose stops, stations, and nearby bikes in settings.</p><button className="primary-button" onClick={openSetup}>Customize your board <ArrowRight size={17} /></button></div> : <div className={`cards-grid card-count-${visibleCards.length}`}>
            {visibleCards.map((card) => <MobilityCard key={card.id} card={card} config={config} now={now} online={online} mode={mode} onConfigure={openSetup} />)}
          </div>}
          {totalPages > 1 && <nav className="board-pagination" aria-label="Board pages"><span>Mobility options</span><div><button aria-label="Previous board page" onClick={() => setPage((safePage - 1 + totalPages) % totalPages)}><ChevronLeft size={16} /></button>{Array.from({ length: totalPages }, (_, index) => <button key={index} className={`page-dot${safePage === index ? ' active' : ''}`} aria-label={`Board page ${index + 1}`} aria-current={safePage === index ? 'page' : undefined} onClick={() => setPage(index)} />)}<button aria-label="Next board page" onClick={() => setPage((safePage + 1) % totalPages)}><ChevronRight size={16} /></button></div><span>{safePage + 1} / {totalPages}</span><button className="rotation-button" aria-pressed={rotating} onClick={() => setRotating(value => !value)}>{rotating ? <Pause size={14} /> : <Play size={14} />}{rotating ? 'Pause rotation' : 'Auto-rotate'}</button></nav>}
        </section>

        {config.preferences.show_map && <aside className="map-section" aria-label="Map of selected stops and vehicles"><div className="section-heading"><h2>Map</h2><span className="section-caption">Stops, bikes, and routes</span></div><div className="neighborhood-map"><MobilityMap origin={config.origin} places={places} vehicles={vehicles} cards={cards} now={now} online={online} mode={mode} timeFormat={config.preferences.time_format} theme={config.preferences.theme} interactive /></div></aside>}
      </div>
    </main>

    <footer inert={setupOpen || infoOpen} className="app-footer"><div className="freshness-status" role="status" aria-live="polite"><span className={`status-dot ${!online || error ? 'amber' : mode === 'demo' ? 'amber' : 'green'}`} />{connectionText}</div><div className="footer-center">{mode === 'demo' ? 'Sample arrivals & availability · not for trip planning' : 'Times are estimates. Check the operator for service changes.'}</div><div className="footer-actions"><button onClick={refresh} aria-label="Refresh board" className={`refresh-button${loading ? ' is-refreshing' : ''}`} disabled={loading || !online}><RefreshCw size={12} /><span>{loading ? 'Refreshing' : board ? `Updated ${refreshAge < 5 ? 'just now' : `${refreshAge}s ago`}` : 'Refresh'}</span></button><button className="attribution-button" onClick={() => { modalTrigger.current = document.activeElement as HTMLElement; setInfoOpen(true); }} aria-label="Data sources and about"><CircleHelp size={13} /><span>Sources & about</span></button></div></footer>

    {setupOpen && <SetupPanel config={config} setConfig={setConfig} catalog={catalog} providers={providers} mode={mode} setMode={setMode} onClose={closeSetup} onDisplay={() => void toggleKiosk()} />}
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
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title"><span className="dialog-eyebrow">Data sources</span><h2 id="about-title">Chicago transit display</h2><p>An open-source neighborhood mobility board for Chicago. No account required. Your configuration stays in this browser.</p>{mode === 'demo' && <div className="notice-box"><TriangleAlert size={18} /><span>You’re viewing a demonstration. All arrivals and vehicle availability on this board are sample data.</span></div>}<h3>Data & mapping</h3><p>{attributions.length ? attributions.join(' · ') : 'CTA transit data and Divvy shared mobility, when connected. Protomaps cartography with OpenStreetMap contributors.'}</p><p>Not affiliated with or endorsed by CTA, Metra, Divvy, or the City of Chicago. Provider data and map tiles remain subject to their own terms. Metra and restricted scooter providers require further integration before live service.</p><button ref={closeRef} className="primary-button" onClick={onClose}>Back to the board <ArrowRight size={17} /></button></section></div>;
}
