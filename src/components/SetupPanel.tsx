import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  ArrowDown, ArrowRight, ArrowUp, Bike, Bus, Check, Copy, Download,
  Expand, FileUp, MapPin, Monitor, Plus, Search, ShieldCheck,
  SlidersHorizontal, TrainFront, TramFront, Trash2, TriangleAlert, X, Zap,
} from 'lucide-react';
import LocationSettings from './LocationSettings';
import { useLocationDraft } from '../lib/useLocationDraft';
import { metraDisclaimer, stationDataDate } from '../lib/data-notices';
import { exportConfig, importConfig, displayLink, resetConfig } from '../lib/config';
import { distanceMeters, formatDistance } from '../lib/format';
import type { BoardConfig, Catalog, Place, PlaceKind, Provider } from '../lib/types';

type Tab = 'location' | 'connections' | 'display' | 'save';
type Props = {
  config: BoardConfig;
  setConfig: Dispatch<SetStateAction<BoardConfig>>;
  catalog: Catalog;
  providers: Provider[];
  mode: 'demo' | 'live';
  setMode: (mode: 'demo' | 'live') => void;
  onClose: () => void;
  onDisplay: () => void;
};
const categories: { id: PlaceKind | 'all'; label: string; icon: typeof Bus; radius: number }[] = [
  { id: 'all', label: 'All', icon: SlidersHorizontal, radius: 2000 },
  { id: 'bus_stop', label: 'Bus', icon: Bus, radius: 800 },
  { id: 'rail_station', label: 'CTA train', icon: TramFront, radius: 1600 },
  { id: 'metra_station', label: 'Metra', icon: TrainFront, radius: 5000 },
  { id: 'shared_station', label: 'Divvy', icon: Bike, radius: 800 },
];
const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export default function SetupPanel({ config, setConfig, catalog, providers, mode, setMode, onClose, onDisplay }: Props) {
  const [tab, setTab] = useState<Tab>('connections');
  const [feedback, setFeedback] = useState('');
  const [feedbackError, setFeedbackError] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const location = useLocationDraft(config, catalog);
  const applyRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  function requestClose(action = onClose) {
    if (location.dirty) {
      setTab('location');
      announce('Apply or discard your location changes before leaving.', true);
      requestAnimationFrame(() => applyRef.current?.focus());
      return;
    }
    action();
  }
  const closeAction = useRef(requestClose); closeAction.current = requestClose;
  function applyLocation() {
    if (!location.canApply) return;
    setConfig(current => location.apply(current));
    location.discard();
    announce('Location applied. Your map, distances, and nearby searches now use this pin.');
    requestAnimationFrame(() => doneRef.current?.focus());
  }
  function discardLocation() {
    location.discard();
    announce('Location changes discarded. Your saved board is unchanged.');
    requestAnimationFrame(() => doneRef.current?.focus());
  }

  function announce(message: string, isError = false) { setFeedback(message); setFeedbackError(isError); }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeAction.current(); }
      if (event.key !== 'Tab') return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, a[href], [tabindex="0"]');
      const elements = Array.from(focusable ?? []).filter(element => element.getClientRects().length > 0);
      if (!elements.length) return;
      const first = elements[0]; const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handler);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', handler); previous?.focus(); };
    // The dialog owns a single focus lifecycle; countdown renders must not steal focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabs: { id: Tab; label: string; icon: typeof MapPin }[] = [
    { id: 'location', label: 'Location', icon: MapPin },
    { id: 'connections', label: 'Connections', icon: Plus },
    { id: 'display', label: 'Display', icon: Monitor },
    { id: 'save', label: 'Save & share', icon: Download },
  ];

  return <div className="setup-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) requestClose(); }}>
    <div ref={panelRef} className="setup-panel" role="dialog" aria-modal="true" aria-labelledby="setup-title">
      <header className="setup-header"><div><span className="dialog-eyebrow">Settings</span><h2 id="setup-title">Customize display</h2><p>Choose locations, mobility options, and display preferences.</p></div><button ref={closeRef} className="icon-button close-setup" aria-label="Close customization" onClick={() => requestClose()}><X size={22} /></button></header>
      <div className="setup-tabs" role="tablist" aria-label="Board settings">{tabs.map((item, index) => <button role="tab" key={item.id} id={`tab-${item.id}`} aria-controls={`panel-${item.id}`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} className={tab === item.id ? 'active' : ''} onClick={() => { setFeedback(''); setTab(item.id); }} onKeyDown={event => {
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        setFeedback(''); setTab(tabs[nextIndex].id); document.getElementById(`tab-${tabs[nextIndex].id}`)?.focus();
      }}><item.icon size={16} />{item.label}</button>)}</div>
      <div className="setup-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'location' && <LocationSettings mode={mode} config={config} catalog={catalog} providers={providers} draft={location} announce={announce} />}
        {tab === 'connections' && <ConnectionsSettings config={config} setConfig={setConfig} catalog={catalog} providers={providers} mode={mode} announce={announce} />}
        {tab === 'display' && <DisplaySettings config={config} setConfig={setConfig} mode={mode} setMode={setMode} />}
        {tab === 'save' && <SaveSettings config={config} setConfig={setConfig} mode={mode} announce={announce} />}
      </div>
      {feedback && <div className={`setup-feedback${feedbackError ? ' is-error' : ''}`} role="status">{feedbackError ? <TriangleAlert size={17} /> : <Check size={17} />}<span>{feedback}</span></div>}
      <footer className={`setup-footer${location.dirty ? ' has-location-draft' : ''}`}>
        <span role="status">{location.dirty ? <MapPin size={15} /> : <ShieldCheck size={15} />}{location.dirty ? 'Location changes not applied' : tab === 'location' ? 'Location saved on this device' : 'Saved automatically on this device'}</span>
        <div>{location.dirty ? <button className="secondary-button" onClick={discardLocation}>Discard changes</button> : <>{tab !== 'location' && <button className="secondary-button setup-display" onClick={() => requestClose(onDisplay)}><Expand size={16} />Display mode</button>}<button ref={doneRef} className={tab === 'location' ? 'secondary-button' : 'primary-button'} onClick={() => requestClose()}>Done <Check size={17} /></button></>}
          {(tab === 'location' || location.dirty) && <button ref={applyRef} className="primary-button" disabled={!location.canApply} onClick={applyLocation}><Check size={16} />Apply location</button>}
        </div>
      </footer>
    </div>
  </div>;
}

type SettingsProps = Pick<Props, 'config' | 'setConfig'>;
type Announce = (message: string, isError?: boolean) => void;


function ConnectionsSettings({ config, setConfig, catalog, providers, mode, announce }: SettingsProps & { catalog: Catalog; providers: Provider[]; mode: 'demo' | 'live'; announce: Announce }) {
  const [category, setCategory] = useState<PlaceKind | 'all'>('all');
  const [radius, setRadius] = useState(2000);
  const [search, setSearch] = useState('');
  const [connectionView, setConnectionView] = useState<'discover' | 'pinned'>('discover');
  const total = config.selections.length + config.vehicle_rules.length;
  const limitReached = total >= 12;
  const places = useMemo(() => catalog.places.map(place => ({ ...place, distance: distanceMeters(config.origin, place) }))
    .filter(place => (category === 'all' || place.kind === category) && place.distance <= radius && `${place.name} ${place.routes.join(' ')} ${place.direction ?? ''}`.toLowerCase().includes(search.toLowerCase().trim()))
    .sort((a, b) => a.distance - b.distance), [catalog, config.origin, category, radius, search]);

  function togglePlace(place: Place) {
    const pinned = config.selections.some(selection => selection.place_id === place.id);
    if (!pinned && limitReached) { announce('This board supports up to 12 cards. Unpin a connection to make room.', true); return; }
    setConfig(current => ({ ...current, selections: pinned ? current.selections.filter(selection => selection.place_id !== place.id) : [...current.selections, { id: uid(), place_id: place.id, limit: 3 }] }));
    announce(pinned ? `${place.name} unpinned.` : `${place.name} added to your board.`);
  }
  function moveSelection(index: number, direction: -1 | 1) {
    setConfig(current => { const selections = [...current.selections]; const target = index + direction; if (target < 0 || target >= selections.length) return current; [selections[index], selections[target]] = [selections[target], selections[index]]; return { ...current, selections }; });
  }
  function addRule(type: 'electric' | 'scooter') {
    if (limitReached || config.vehicle_rules.length >= 3) { announce('Remove a card or vehicle search before adding another.', true); return; }
    setConfig(current => ({ ...current, vehicle_rules: [...current.vehicle_rules, { id: uid(), provider_id: 'divvy', type, radius_m: 800, limit: 3 }] }));
    announce(`Nearby ${type === 'electric' ? 'e-bike' : 'scooter'} search added. Availability depends on the connected feed.`);
  }

  return <div className="settings-stack">
    <div className="settings-intro connections-intro"><div><h3>Mobility options</h3><p>Select the stops, stations, and bikes to display.</p></div><span className="capacity-pill">{total}<span>/ 12 cards</span></span></div>
    <div className="segmented-control connections-switch"><button className={connectionView === 'discover' ? 'active' : ''} onClick={() => setConnectionView('discover')}>Find nearby</button><button className={connectionView === 'pinned' ? 'active' : ''} onClick={() => setConnectionView('pinned')}>Pinned & order <span>{total}</span></button></div>
    {connectionView === 'discover' ? <>
      <div className="category-filters" role="group" aria-label="Connection category">{categories.map(item => <button key={item.id} aria-pressed={category === item.id} className={category === item.id ? 'active' : ''} onClick={() => { setCategory(item.id); setRadius(item.radius); }}><item.icon size={16} />{item.label}</button>)}</div>
      <div className="discovery-search"><div className="search-field"><Search size={17} /><input aria-label="Search stops and stations" placeholder="Search a stop, station, or route" value={search} onChange={event => setSearch(event.target.value)} /></div><label className="radius-field">Within<select aria-label="Discovery radius" value={radius} onChange={event => setRadius(Number(event.target.value))}><option value={800}>800 m</option><option value={1600}>1.6 km</option><option value={2000}>2 km</option><option value={5000}>5 km</option><option value={10000}>10 km</option><option value={80000}>Chicago region</option></select></label></div>
      <div className="results-heading"><span>{places.length} {places.length === 1 ? 'place' : 'places'} found</span><span>Nearest first · approximate distance</span></div>
      <div className="place-results">{places.length ? places.map(place => {
        const selected = config.selections.some(selection => selection.place_id === place.id);
        const Icon = categories.find(item => item.id === place.kind)?.icon ?? MapPin;
        const provider = providers.find(item => item.id === place.provider_id);
        return <div className={`place-result${selected ? ' is-selected' : ''}`} key={place.id}><span className={`place-icon kind-${place.kind}`}><Icon size={22} /></span><div className="place-copy"><strong>{place.name}</strong><span>{place.direction || categories.find(item => item.id === place.kind)?.label}{place.routes.length > 0 && <span className="place-routes"> · {place.routes.slice(0, 5).join(', ')}</span>}</span>{mode === 'live' && provider && provider.connection_state !== 'enabled' && <small className="provider-pending">{provider.connection_state === 'pending' ? 'Integration pending' : 'Provider not connected'}</small>}</div><span className="place-distance">{formatDistance(place.distance)}</span><button className={`pin-button${selected ? ' pinned' : ''}`} aria-label={`${selected ? 'Unpin' : 'Pin'} ${place.name}${place.direction ? ` ${place.direction}` : ''}`} aria-pressed={selected} disabled={!selected && limitReached} onClick={() => togglePlace(place)}>{selected ? <Check size={17} /> : <Plus size={17} />}</button></div>;
      }) : <div className="no-results"><Search size={27} /><strong>No stops in this search.</strong><p>Try a different name, category, or a larger radius.</p><button className="secondary-button" onClick={() => setRadius(Math.min(80000, radius * 2))}>Expand the search</button></div>}</div>
      <p className="catalog-note">{catalog.coverage_note || 'Stop choices come from the connected catalog.'} {metraDisclaimer} {mode === 'demo' ? 'This is a sample catalog for the demo board.' : `Station data updated ${stationDataDate(catalog.version)}.`}</p>
    </> : <div className="pinned-list">{!config.selections.length && !config.vehicle_rules.length && <div className="no-results"><MapPin size={26} /><strong>No stops selected</strong><p>Choose a nearby stop to add it to the display.</p></div>}{config.selections.map((selection, index) => {
      const place = catalog.places.find(item => item.id === selection.place_id);
      return <div className="pinned-item" key={selection.id}><div className="pinned-topline"><span className="pinned-number">{String(index + 1).padStart(2, '0')}</span><div><strong>{place?.name ?? 'Stop no longer in catalog'}</strong><small>{place?.direction || place?.kind.replaceAll('_', ' ') || selection.place_id}</small></div><div className="reorder-buttons"><button className="icon-button" aria-label={`Move ${place?.name ?? 'stop'} up`} disabled={index === 0} onClick={() => moveSelection(index, -1)}><ArrowUp size={16} /></button><button className="icon-button" aria-label={`Move ${place?.name ?? 'stop'} down`} disabled={index === config.selections.length - 1} onClick={() => moveSelection(index, 1)}><ArrowDown size={16} /></button><button className="icon-button remove-button" aria-label={`Remove ${place?.name ?? 'stop'}`} onClick={() => setConfig(current => ({ ...current, selections: current.selections.filter(item => item.id !== selection.id) }))}><Trash2 size={15} /></button></div></div>
        {place?.kind !== 'shared_station' && <div className="selection-filters"><label>Route<select aria-label={`Route for ${place?.name ?? 'stop'}`} value={selection.route ?? ''} onChange={event => setConfig(current => ({ ...current, selections: current.selections.map(item => item.id === selection.id ? { ...item, route: event.target.value || undefined } : item) }))}><option value="">All routes</option>{place?.routes.map(route => <option key={route} value={route}>{route}</option>)}</select></label><label>Destination<input aria-label={`Destination for ${place?.name ?? 'stop'}`} value={selection.destination ?? ''} placeholder="All destinations" maxLength={100} onChange={event => setConfig(current => ({ ...current, selections: current.selections.map(item => item.id === selection.id ? { ...item, destination: event.target.value || undefined } : item) }))} /></label><label>Per direction<select aria-label={`Arrival limit for ${place?.name ?? 'stop'}`} value={selection.limit} onChange={event => setConfig(current => ({ ...current, selections: current.selections.map(item => item.id === selection.id ? { ...item, limit: Number(event.target.value) } : item) }))}>{[1, 2, 3, 4, 5].map(value => <option key={value}>{value}</option>)}</select></label></div>}
      </div>;
    })}{config.selections.length > 0 && <p className="field-hint">Arrival limits apply per route and destination. Map labels show the next two available times. Destination filters match the provider’s destination text exactly. Shared vehicle searches follow your pinned stops.</p>}</div>}

    <section className="vehicle-rules-section"><div className="settings-section-title"><span><Zap size={19} /><h3>Undocked Divvy vehicles</h3></span><span className="small-tag">DYNAMIC SEARCH</span></div><p className="field-hint">Find available Divvy vehicles on every refresh. Searches stay pinned as individual rides come and go.</p>
      <div className="vehicle-rules">{config.vehicle_rules.map((rule, index) => <div className="vehicle-rule" key={rule.id}><div className="vehicle-rule-heading"><span className="place-icon"><Zap size={20} /></span><div><strong>Nearby {rule.type === 'electric' ? 'e-bikes' : 'scooters'}</strong><small>Divvy · closest available first</small></div><button className="icon-button" aria-label={`Remove nearby ${rule.type === 'electric' ? 'e-bikes' : 'scooters'} search`} onClick={() => setConfig(current => ({ ...current, vehicle_rules: current.vehicle_rules.filter(item => item.id !== rule.id) }))}><Trash2 size={16} /></button></div><div className="rule-fields"><label>Search radius<select aria-label={`Search radius for vehicle rule ${index + 1}`} value={rule.radius_m} onChange={event => setConfig(current => ({ ...current, vehicle_rules: current.vehicle_rules.map(item => item.id === rule.id ? { ...item, radius_m: Number(event.target.value) } : item) }))}>{[200, 400, 800, 1200, 1600, 2000].map(value => <option key={value} value={value}>{value < 1000 ? `${value} m` : `${value / 1000} km`}</option>)}</select></label><label>Show up to<select aria-label={`Vehicle limit for rule ${index + 1}`} value={rule.limit} onChange={event => setConfig(current => ({ ...current, vehicle_rules: current.vehicle_rules.map(item => item.id === rule.id ? { ...item, limit: Number(event.target.value) } : item) }))}>{[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value} {value === 1 ? 'vehicle' : 'vehicles'}</option>)}</select></label></div></div>)}</div>
      <div className="add-rule-buttons"><button className="secondary-button" disabled={limitReached || config.vehicle_rules.length >= 3} onClick={() => addRule('electric')}><Plus size={15} />E-bike search</button><button className="secondary-button" disabled={limitReached || config.vehicle_rules.length >= 3} onClick={() => addRule('scooter')}><Plus size={15} />Scooter search</button></div><p className="field-hint">Scooters appear only when positively identified in an enabled Divvy feed. Lime and other restricted feeds are not connected.</p>
    </section>
    <section className="provider-section"><h3>Provider connections</h3><div className="provider-list">{providers.map(provider => <div key={provider.id}><span><strong>{provider.name}</strong>{provider.message && <small>{provider.message}</small>}</span><span className={`provider-state ${mode === 'demo' ? 'demo' : provider.connection_state}`}><i className="status-dot" />{mode === 'demo' ? 'Demo data' : provider.connection_state === 'enabled' ? 'Enabled' : provider.connection_state === 'pending' ? 'Pending' : 'Not connected'}</span></div>)}</div><p className="field-hint">Provider credentials are configured on the server by the board operator. No rider account is needed.</p></section>
  </div>;
}

function DisplaySettings({ config, setConfig, mode, setMode }: SettingsProps & Pick<Props, 'mode' | 'setMode'>) {
  function preference<K extends keyof BoardConfig['preferences']>(key: K, value: BoardConfig['preferences'][K]) { setConfig(current => ({ ...current, preferences: { ...current.preferences, [key]: value } })); }
  return <div className="settings-stack">
    <div className="settings-intro"><h3>Display preferences</h3><p>Adjust theme, text size, and screen layout.</p></div>
    <label className="stacked-label">Display label<input id="display-label" value={config.label} maxLength={80} onChange={event => setConfig(current => ({ ...current, label: event.target.value }))} placeholder="Your neighborhood" /><span className="field-hint">A local label, like “River North” or “The lobby”. Omitted from display links.</span></label>
    <div className="setting-row"><div><strong>Board data</strong><span>Choose sample data or connected providers.</span></div><div className="segmented-control"><button className={mode === 'demo' ? 'active' : ''} aria-pressed={mode === 'demo'} onClick={() => setMode('demo')}>Demo</button><button className={mode === 'live' ? 'active' : ''} aria-pressed={mode === 'live'} onClick={() => setMode('live')}>Live</button></div></div>
    <div className="setting-row"><div><strong>Appearance</strong><span>Make it comfortable for your space.</span></div><div className="segmented-control"><button className={config.preferences.theme === 'dark' ? 'active' : ''} aria-pressed={config.preferences.theme === 'dark'} onClick={() => preference('theme', 'dark')}>Dark</button><button className={config.preferences.theme === 'light' ? 'active' : ''} aria-pressed={config.preferences.theme === 'light'} onClick={() => preference('theme', 'light')}>Light</button></div></div>
    <div className="setting-row"><div><strong>Clock format</strong><span>Always Chicago local time.</span></div><div className="segmented-control"><button className={config.preferences.time_format === '12h' ? 'active' : ''} aria-pressed={config.preferences.time_format === '12h'} onClick={() => preference('time_format', '12h')}>12 hour</button><button className={config.preferences.time_format === '24h' ? 'active' : ''} aria-pressed={config.preferences.time_format === '24h'} onClick={() => preference('time_format', '24h')}>24 hour</button></div></div>
    <div className="setting-row"><div><strong>Text size</strong><span>Give arrivals a little more room.</span></div><label className="scale-control"><span className="sr-only">Text size</span><input type="range" min="0.9" max="1.3" step="0.1" value={config.preferences.text_scale} onChange={event => preference('text_scale', Number(event.target.value))} /><output>{Math.round(config.preferences.text_scale * 100)}%</output></label></div>
    <div className="setting-row"><div><strong>Neighborhood map</strong><span>Show stops and routes alongside the mobility list.</span></div><button role="switch" aria-checked={config.preferences.show_map} aria-label="Show neighborhood map" className={`switch${config.preferences.show_map ? ' on' : ''}`} onClick={() => preference('show_map', !config.preferences.show_map)}><span /></button></div>
    <div className="setting-row"><div><strong>Service notices</strong><span>Show alerts when a feed supplies them.</span></div><button role="switch" aria-checked={config.preferences.show_alerts} aria-label="Show service notices" className={`switch${config.preferences.show_alerts ? ' on' : ''}`} onClick={() => preference('show_alerts', !config.preferences.show_alerts)}><span /></button></div>
    <div className="orientation-setting"><label htmlFor="orientation">Screen orientation</label><select id="orientation" value={config.preferences.orientation} onChange={event => preference('orientation', event.target.value as BoardConfig['preferences']['orientation'])}><option value="auto">Automatic · follow the screen</option><option value="landscape">Landscape</option><option value="portrait">Portrait</option></select><div className={`orientation-preview ${config.preferences.orientation}`} aria-hidden="true"><span className="preview-screen"><span /><span /><span /><span /></span><div><strong>{config.preferences.orientation === 'auto' ? 'Fits right in.' : config.preferences.orientation === 'portrait' ? 'A taller point of view.' : 'A little room to spread out.'}</strong><small>Cards paginate automatically to keep the display readable. Pages rotate every 25 seconds.</small></div></div></div>
    <div className="notice-box"><Monitor size={19} /><span>Display mode opens fullscreen and requests a screen wake lock. For an unattended screen, also configure your device’s kiosk and power settings.</span></div>
  </div>;
}

function SaveSettings({ config, setConfig, mode, announce }: SettingsProps & Pick<Props, 'mode'> & { announce: Announce }) {
  const [importText, setImportText] = useState('');
  const [link, setLink] = useState('');
  const [resetArmed, setResetArmed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  async function copyLink() {
    try {
      const url = displayLink(config, mode); setLink(url);
      if (!navigator.clipboard?.writeText) { announce('Display link is ready below. Select and copy it.'); return; }
      await navigator.clipboard.writeText(url); announce('Display link copied. It opens an independent copy of this board.');
    } catch { announce('The clipboard is unavailable. Select and copy the display link below.', true); }
  }
  function applyImport(text: string) {
    try { const parsed = importConfig(text); setConfig(parsed); setImportText(''); announce('Settings imported and saved on this device.'); }
    catch (error) { announce(error instanceof Error ? error.message : 'That settings file could not be read.', true); }
  }
  return <div className="settings-stack">
    <div className="settings-intro"><h3>Save and share</h3><p>No sign-in, no account. Keep a backup or bring this board to another screen.</p></div>
    <div className="saved-locally"><span><ShieldCheck size={23} /></span><div><strong>Saved on this browser</strong><p>Changes save automatically. Keep an export if you clear browser storage or use a private window.</p></div><Check size={19} /></div>
    <div className="share-option"><div><span className="share-option-icon"><Copy size={22} /></span><div><h3>Open on another display</h3><p>Copy a link, open it on your lobby screen, and enter display mode.</p></div></div><button className="primary-button" onClick={() => void copyLink()}><Copy size={16} />Copy display link</button></div>
    <div className="notice-box"><MapPin size={18} /><span>Anyone with this link can see the board’s coordinates and selected stops. Your private display label is excluded. Links create independent copies; later edits won’t sync.</span></div>
    {link && <label className="stacked-label">Display link<textarea aria-label="Display link" value={link} readOnly rows={3} onFocus={event => event.target.select()} /></label>}
    <div className="share-option"><div><span className="share-option-icon"><Download size={22} /></span><div><h3>Keep a settings backup</h3><p>Download a small JSON file with your board settings, including your local label.</p></div></div><button className="secondary-button" onClick={() => { try { exportConfig(config); announce('Settings exported. Keep your backup somewhere safe.'); } catch { announce('Settings could not be exported in this browser.', true); } }}><Download size={16} />Export settings</button></div>
    <section className="import-section"><div className="settings-section-title"><span><FileUp size={20} /><h3>Bring back a board</h3></span></div><p className="field-hint">Importing replaces the settings on this device. Export your current board first if you’d like to keep it.</p><input type="file" ref={fileInput} className="sr-only" accept=".json,application/json" aria-label="Import settings file" onChange={async event => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 16384) { announce('Settings files must be 16 KiB or smaller.', true); return; } applyImport(await file.text()); event.target.value = ''; }} /><button className="secondary-button" onClick={() => fileInput.current?.click()}><FileUp size={16} />Choose settings file</button><label className="stacked-label import-paste">Or paste settings JSON<textarea aria-label="Settings JSON" value={importText} onChange={event => setImportText(event.target.value)} placeholder={'{ "version": 1, ... }'} rows={4} maxLength={16384} /></label><button className="secondary-button" disabled={!importText.trim()} onClick={() => applyImport(importText)}>Import settings <ArrowRight size={16} /></button></section>
    <div className="reset-section"><div><strong>Start a fresh board</strong><p>Restore the sample selections and display preferences on this device.</p></div>{resetArmed ? <div className="reset-actions"><button className="text-button" onClick={() => setResetArmed(false)}>Cancel</button><button className="danger-button" onClick={() => { setConfig(resetConfig()); setResetArmed(false); announce('This device’s board settings were reset.'); }}>Confirm reset</button></div> : <button className="text-button danger-text" onClick={() => setResetArmed(true)}>Reset this device</button>}</div>
  </div>;
}
