import { useMemo, useState } from 'react';
import { nearbyLocationOptions, validOrigin } from './location';
import type { BoardConfig, Catalog, Origin, Selection } from './types';

export function useLocationDraft(config: BoardConfig, catalog: Catalog) {
  const [coordinates, setCoordinates] = useState<{ latitude: string; longitude: string } | null>(null);
  const [mapOrigin, setMapOrigin] = useState<Origin | null>(null);
  const [customName, setCustomName] = useState<string | null>(null);
  const [replaceStops, setReplaceStops] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);
  const [focusKey, setFocusKey] = useState(0);
  const latitude = coordinates?.latitude ?? config.origin.lat.toFixed(6);
  const longitude = coordinates?.longitude ?? config.origin.lon.toFixed(6);
  const valid = latitude.trim() !== '' && longitude.trim() !== '' && validOrigin(Number(latitude), Number(longitude));
  const origin = useMemo(() => ({ lat: Number(latitude), lon: Number(longitude) }), [latitude, longitude]);
  const previewOrigin = valid ? origin : mapOrigin ?? config.origin;
  const moved = valid && (latitude !== config.origin.lat.toFixed(6) || longitude !== config.origin.lon.toFixed(6));
  const { suggestions, suggestedName } = useMemo(() => nearbyLocationOptions(previewOrigin, catalog.places), [previewOrigin.lat, previewOrigin.lon, catalog.places]);
  const name = customName ?? (moved ? suggestedName : config.label);
  const chosen = suggestions.filter(place => selectedIds === null || selectedIds.includes(place.id));
  const dirty = coordinates !== null || customName !== null || replaceStops;
  const canApply = dirty && valid && name.trim().length > 0 && name.trim().length <= 80 && (!replaceStops || chosen.length > 0);

  function setOrigin(next: Origin, recenter = false) {
    setCoordinates({ latitude: next.lat.toFixed(6), longitude: next.lon.toFixed(6) });
    setMapOrigin(next); setSelectedIds(null);
    if (recenter) setFocusKey(value => value + 1);
  }
  function setCoordinate(field: 'latitude' | 'longitude', value: string) {
    setCoordinates({ latitude, longitude, [field]: value }); setSelectedIds(null);
  }
  function discard() {
    setCoordinates(null); setMapOrigin(null); setCustomName(null); setReplaceStops(false); setSelectedIds(null);
    setFocusKey(value => value + 1);
  }
  function apply(current: BoardConfig): BoardConfig {
    const selections: Selection[] = replaceStops ? chosen.map((place, index) => ({ id: `location:${crypto.randomUUID?.() ?? `${Date.now()}-${index}`}`, place_id: place.id, limit: 2 })) : current.selections;
    return { ...current, origin, label: name.trim(), selections };
  }
  function toggleStop(id: string) {
    setSelectedIds(current => {
      const ids = current ?? suggestions.map(place => place.id);
      return ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id];
    });
  }
  return { latitude, longitude, origin: previewOrigin, name, suggestions, suggestedName, chosen, replaceStops, focusKey, valid, dirty, canApply, setOrigin, setCoordinate, setName: setCustomName, setReplaceStops, toggleStop, discard, apply, recenter: () => setFocusKey(value => value + 1) };
}
