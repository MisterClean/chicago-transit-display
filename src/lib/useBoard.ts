import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { capabilitiesSchema, catalogSchema, boardSchema, configSchema } from './schema';
import { createDemoBoard, demoCatalog } from './demo';
import { loadConfig, serializeConfig, STORAGE_KEY } from './config';
import type { BoardConfig, BoardQuery, BoardResponse, Catalog, DataMode, Provider } from './types';

const MODE_KEY = 'near-next:mode';
function initialMode(): DataMode {
  if (window.location.hash.startsWith('#v1=')) return new URLSearchParams(window.location.hash.slice(1)).get('mode') === 'demo' ? 'demo' : 'live';
  try { return localStorage.getItem(MODE_KEY) === 'demo' ? 'demo' : 'live'; } catch { return 'live'; }
}
async function getJson(url: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
  const response = await fetch(url, { method: body ? 'POST' : 'GET', signal, headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error(response.status === 429 ? 'The board is busy. Retrying shortly.' : `Board service unavailable (${response.status}). Retrying automatically.`);
  const text = await response.text();
  if (text.length > 8_000_000) throw new Error('Board service returned too much data.');
  return JSON.parse(text);
}
export function toBoardQuery(config: BoardConfig): BoardQuery {
  return { selections: config.selections.map(selection => ({ ...selection, ...(selection.route !== undefined ? { route: selection.route.trim() || undefined } : {}), ...(selection.destination !== undefined ? { destination: selection.destination.trim() || undefined } : {}) })), vehicle_rules: config.vehicle_rules, ...(config.vehicle_rules.length ? { origin: config.origin } : {}) };
}

export function useBoard() {
  const [initial] = useState(loadConfig);
  const [config, setConfig] = useState<BoardConfig>(initial.config);
  const [mode, setModeState] = useState<DataMode>(initialMode);
  const [board, setBoard] = useState<BoardResponse | null>(() => mode === 'demo' ? createDemoBoard(initial.config) : null);
  const [catalog, setCatalog] = useState<Catalog>(() => mode === 'demo' ? demoCatalog : { version: '', places: [], coverage_note: 'Connecting to the live place catalog.' });
  const [providers, setProviders] = useState<Provider[]>(() => board?.providers ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initial.warning ?? null);
  const [storageWarning, setStorageWarning] = useState<string | null>(initial.warning ?? null);
  const [online, setOnline] = useState(navigator.onLine);
  const [refreshKey, setRefreshKey] = useState(0);
  const catalogVersion = useRef('');
  const query = useMemo(() => toBoardQuery(config), [config]);
  const queryKey = JSON.stringify(query);
  const refresh = useCallback(() => setRefreshKey(value => value + 1), []);
  const setMode = useCallback((next: DataMode) => {
    if (next === mode) return;
    setBoard(null); setError(null); setProviders([]); catalogVersion.current = '';
    setCatalog(next === 'demo' ? demoCatalog : { version: '', places: [], coverage_note: 'Connecting to the live place catalog.' });
    setModeState(next);
    try { localStorage.setItem(MODE_KEY, next); } catch { setStorageWarning('Browser storage is unavailable. Export settings to keep a copy.'); }
  }, [mode]);
  useEffect(() => {
    const valid = configSchema.safeParse({ ...config, selections: toBoardQuery(config).selections });
    if (!valid.success) return; // Keep the last valid save while a form field is incomplete.
    try { localStorage.setItem(STORAGE_KEY, serializeConfig(valid.data)); }
    catch { setStorageWarning('Settings could not be saved in this browser. Export settings to keep a copy.'); }
  }, [config]);
  useEffect(() => {
    // A shared link imports an independent copy once. Future reloads use local edits.
    if (window.location.hash.startsWith('#v1=') && !initial.warning) {
      try { localStorage.setItem(MODE_KEY, mode); history.replaceState(null, '', window.location.pathname + window.location.search); }
      catch { /* Retain the recoverable link when storage is unavailable. */ }
    }
  }, [initial.warning, mode]);
  useEffect(() => {
    const onOnline = () => { setOnline(true); refresh(); };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, [refresh]);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    let failures = 0;
    const poll = async () => {
      if (disposed) return;
      if (mode === 'demo') {
        const response = createDemoBoard(config);
        setBoard(response); setProviders(response.providers); setCatalog(demoCatalog); setLoading(false); setError(null);
        timer = setTimeout(poll, 30000); return;
      }
      if (!navigator.onLine) { setLoading(false); timer = setTimeout(poll, 30000); return; }
      setLoading(true);
      const request = new AbortController();
      const cancel = () => request.abort(); controller.signal.addEventListener('abort', cancel, { once: true });
      const timeout = setTimeout(cancel, 15000);
      let next = 30000;
      try {
        if (!catalogVersion.current) {
          const [capabilityData, catalogData] = await Promise.all([getJson('/api/v1/capabilities', request.signal), getJson('/api/v1/catalog', request.signal)]);
          const capabilities = capabilitiesSchema.parse(capabilityData);
          const currentCatalog = catalogSchema.parse(catalogData);
          if (disposed) return;
          setProviders(capabilities.providers); setCatalog(currentCatalog); catalogVersion.current = currentCatalog.version;
        }
        const response = boardSchema.parse(await getJson('/api/v1/board/query', request.signal, query));
        if (disposed) return;
        setBoard(response); setProviders(response.providers); setError(null); failures = 0;
        if (response.catalog_version !== catalogVersion.current) catalogVersion.current = '';
        next = Math.max(5000, response.next_poll_after_s * 1000) * (0.95 + Math.random() * 0.1);
      } catch (err) {
        if (disposed) return;
        failures++;
        setError(request.signal.aborted ? 'Board service timed out. Retrying automatically.' : err instanceof Error && !(err.name === 'ZodError' || err.name === 'SyntaxError') ? err.message : 'The board service returned invalid data. Retrying automatically.');
        // Retained snapshots keep their original timestamps and expire in the UI.
        setBoard(previous => previous ? { ...previous, cards: previous.cards.map(card => card.state === 'ready' ? { ...card, state: 'stale' as const } : card) } : null);
        next = Math.min(120000, 10000 * 2 ** Math.min(failures - 1, 4));
      } finally {
        clearTimeout(timeout); controller.signal.removeEventListener('abort', cancel);
        if (!disposed) { setLoading(false); timer = setTimeout(poll, next); }
      }
    };
    void poll();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
    // Display preferences never trigger provider requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, queryKey, refreshKey]);
  return { config, setConfig, board, catalog, providers, loading, error: error || storageWarning, online, refresh, mode, setMode };
}
