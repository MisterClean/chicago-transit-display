import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronRight, LocateFixed, MapPin, Search } from 'lucide-react';
import MobilityMap from './MobilityMap';
import { distanceMeters, formatDistance } from '../lib/format';
import { validOrigin } from '../lib/location';
import type { useLocationDraft } from '../lib/useLocationDraft';
import type { BoardConfig, Catalog, GeocodeResponse, Provider } from '../lib/types';

type Props = {
  config: BoardConfig; catalog: Catalog; providers: Provider[]; mode: 'demo' | 'live';
  draft: ReturnType<typeof useLocationDraft>;
  announce: (message: string, isError?: boolean) => void;
};

export default function LocationSettings({ config, catalog, providers, mode, draft, announce }: Props) {
  const [address, setAddress] = useState('');
  const [candidates, setCandidates] = useState<GeocodeResponse['candidates']>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const deadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requestRef.current?.abort(); if (deadlineRef.current) clearTimeout(deadlineRef.current); }; }, []);
  const distantStops = config.selections.filter(selection => {
    const place = catalog.places.find(item => item.id === selection.place_id);
    return place && distanceMeters(draft.origin, place) > 2000;
  }).length;
  async function searchAddress(event: FormEvent) {
    event.preventDefault();
    if (!address.trim()) return;
    requestRef.current?.abort(); if (deadlineRef.current) clearTimeout(deadlineRef.current);
    const controller = new AbortController(); requestRef.current = controller;
    const deadline = setTimeout(() => controller.abort(), 15_000); deadlineRef.current = deadline;
    setSearching(true); setCandidates([]);
    try {
      const response = await fetch('/api/v1/geocode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: address.trim() }), signal: controller.signal });
      const result: GeocodeResponse & { error?: string } = await response.json();
      if (!response.ok) throw new Error(result.error || 'Address search is unavailable. Place a pin or enter coordinates.');
      if (!Array.isArray(result.candidates)) throw new Error('Address search returned an invalid response. Try a map pin.');
      const valid = result.candidates.filter(candidate => typeof candidate.label === 'string' && validOrigin(candidate.lat, candidate.lon));
      setCandidates(valid);
      if (!valid.length) announce(result.message || 'No Chicago locations found. Try a more specific address or place a map pin.', true);
      else announce('Choose an address, then apply your location.');
    } catch (error) {
      if (!mounted.current || requestRef.current !== controller) return;
      if (controller.signal.aborted) announce('Address search timed out. Try again, place a map pin, or enter coordinates.', true);
      else if (error instanceof Error) announce(error.message, true);
    } finally {
      clearTimeout(deadline);
      if (deadlineRef.current === deadline) deadlineRef.current = null;
      if (mounted.current && requestRef.current === controller) setSearching(false);
    }
  }
  function useLocation() {
    if (!navigator.geolocation) { announce('Location is unavailable in this browser. Use the map or coordinates instead.', true); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(position => {
      if (!mounted.current) return;
      setLocating(false);
      if (!validOrigin(position.coords.latitude, position.coords.longitude)) { announce('Your location is outside the Chicago service area. Choose a Chicago entrance with the map or coordinates.', true); return; }
      setAccuracy(Math.round(position.coords.accuracy));
      draft.setOrigin({ lat: position.coords.latitude, lon: position.coords.longitude }, true);
      announce(`Location found with approximately ${Math.round(position.coords.accuracy)} m accuracy. Adjust the pin, then apply your location.`);
    }, error => {
      if (!mounted.current) return;
      setLocating(false); announce(error.code === 1 ? 'Location permission was declined. You can still place a pin or enter coordinates.' : 'Couldn’t find your location. Try a map pin or coordinates.', true);
    }, { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 });
  }
  return <div className="settings-stack location-settings">
    <div className="settings-intro"><h3>Drop a pin</h3><p>Pan and zoom to your corner, then click to place your pin. Apply when it looks right.</p></div>
    <div className="setup-map"><MobilityMap mode={mode} catalogVersion={catalog.version} origin={draft.origin} places={[]} interactive onOriginChange={origin => draft.setOrigin(origin)} focusKey={draft.focusKey} theme={config.preferences.theme} /></div>
    <div className="location-alternatives"><button className="secondary-button" onClick={useLocation} disabled={locating}><LocateFixed size={17} />{locating ? 'Finding your location…' : 'Use my location'}</button><span>{draft.dirty ? 'Preview · not applied yet' : 'Your saved location'}</span></div>
    <div className="location-name"><label className="stacked-label">Location name<input value={draft.name} maxLength={80} onChange={event => draft.setName(event.target.value)} placeholder="Your neighborhood or corner" /></label>{draft.name !== draft.suggestedName && draft.suggestedName !== 'My neighborhood' && <button className="text-button" onClick={() => draft.setName(draft.suggestedName)}>Use nearby name: {draft.suggestedName}</button>}</div>
    <fieldset className="location-stops"><legend>Stops for this location</legend><p className="field-hint">Choose what appears when you apply. Nearby vehicle searches always follow your pin.</p>
      {distantStops > 0 && <p className="location-distance-note">{distantStops} of your pinned stops {distantStops === 1 ? 'is' : 'are'} more than 2 km from this pin.</p>}
      <div className="location-stop-choices">
        <label><input type="radio" name="location-stops" checked={!draft.replaceStops} onChange={() => draft.setReplaceStops(false)} /><span>Keep my pinned stops<small>{config.selections.length} stops · update their distances</small></span></label>
        <label><input type="radio" name="location-stops" checked={draft.replaceStops} disabled={!draft.suggestions.length} onChange={() => draft.setReplaceStops(true)} /><span>Replace with nearby stops<small>Review the suggestions below</small></span></label>
      </div>
      <div className="location-preview" aria-label="Nearby stop preview">
        {draft.suggestions.map(place => {
          const provider = providers.find(item => item.id === place.provider_id);
          return <label className="location-preview-stop" key={place.id}>
            {draft.replaceStops ? <input type="checkbox" checked={draft.chosen.some(item => item.id === place.id)} onChange={() => draft.toggleStop(place.id)} aria-label={`Include ${place.name}${place.direction ? ` ${place.direction}` : ''}`} /> : <MapPin size={17} aria-hidden="true" />}
            <span><strong>{place.name}</strong><small>{place.direction || (place.kind === 'shared_station' ? 'Divvy' : place.kind === 'metra_station' ? 'Metra' : 'CTA train')}{place.routes.length > 0 && ` · ${place.routes.join(', ')}`}{mode === 'live' && provider && provider.connection_state !== 'enabled' && ' · Live arrivals not connected'}</small></span><span className="place-distance">{formatDistance(place.distance)}</span>
          </label>;
        })}
        {!draft.suggestions.length && <p className="field-hint">{mode === 'demo' ? 'No sample stops near this pin. Live mode has the full Chicago catalog.' : catalog.version ? 'No stops found nearby. You can keep your pinned stops and search a wider area in Connections.' : 'Waiting for the live stop catalog. You can still apply your pin and keep your stops.'}</p>}
      </div>
      {draft.replaceStops && draft.chosen.length === 0 && <p className="field-hint" role="status">Choose at least one stop or keep your current pins.</p>}
    </fieldset>
    <details className="location-details"><summary>Enter coordinates</summary><div className="coordinate-fields">
      <label htmlFor="latitude">Latitude<input id="latitude" type="number" min="41.6" max="42.1" step="0.000001" value={draft.latitude} onChange={event => draft.setCoordinate('latitude', event.target.value)} onBlur={() => { if (draft.valid) draft.recenter(); }} /></label>
      <label htmlFor="longitude">Longitude<input id="longitude" type="number" min="-88" max="-87.45" step="0.000001" value={draft.longitude} onChange={event => draft.setCoordinate('longitude', event.target.value)} onBlur={() => { if (draft.valid) draft.recenter(); }} /></label>
    </div>{!draft.valid && <p className="field-hint" role="status">Enter valid Chicago coordinates: latitude 41.60–42.10 and longitude −88.00 to −87.45.</p>}</details>
    <details className="location-details"><summary>Find an address</summary>
      <form onSubmit={event => void searchAddress(event)} className="address-form"><label htmlFor="board-address">Find a Chicago address</label><div className="input-action"><span className="input-icon"><Search size={18} /></span><input id="board-address" value={address} onChange={event => setAddress(event.target.value)} placeholder="Street address, Chicago, IL" maxLength={200} /><button className="primary-button" type="submit" disabled={searching || !address.trim()}>{searching ? 'Searching…' : 'Find address'}</button></div><p className="field-hint">Searching sends the address you submit to Geocodio when connected. Enter an address only, without names or other personal details.</p></form>
      {candidates.length > 0 && <div className="address-candidates" aria-label="Address results">{candidates.map((candidate, index) => <button key={`${candidate.lat}-${candidate.lon}-${index}`} onClick={() => { draft.setOrigin(candidate, true); setCandidates([]); }}><MapPin size={17} /><span>{candidate.label}</span><ChevronRight size={17} /></button>)}</div>}
    </details>
    <p className="field-hint">{accuracy !== null && `GPS accuracy: approximately ${accuracy} m. `}Distances are straight-line estimates. Your pin and location name are saved only when you apply. Address searches are not saved.</p>
  </div>;
}
