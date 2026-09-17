import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoBoard, demoCatalog, defaultConfig } from '../src/lib/demo';
import { toBoardQuery, useBoard } from '../src/lib/useBoard';
import { config } from './fixtures';

type HookState = ReturnType<typeof useBoard>;
let root: Root;
let container: HTMLDivElement;
let current: HookState;

function Harness() {
  current = useBoard();
  return null;
}

const respond = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const capabilities = () => ({ schema_version: 1, catalog_version: demoCatalog.version, providers: [], geocoding: false, limits: { max_cards: 12, max_radius_m: 2000 } });

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  history.replaceState(null, '', '/');
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('board requests and recovery', () => {
  it('sends only selections and rules; fixed-stop queries omit location', () => {
    const original = config();
    const fixed = toBoardQuery({ ...original, vehicle_rules: [] });
    expect(fixed).toEqual({ selections: original.selections, vehicle_rules: [] });
    expect(JSON.stringify(fixed)).not.toContain(original.label);
    expect(fixed).not.toHaveProperty('preferences');
    expect(fixed).not.toHaveProperty('origin');
    expect(toBoardQuery(original).origin).toEqual(original.origin);
  });

  it('runs an explicit demo without calling live APIs', async () => {
    localStorage.setItem('near-next:mode', 'demo');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => root.render(<Harness />));
    expect(current.mode).toBe('demo');
    expect(current.board?.cards.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the current board when the already-active mode button is pressed', async () => {
    localStorage.setItem('near-next:mode', 'demo');
    vi.stubGlobal('fetch', vi.fn());
    await act(async () => root.render(<Harness />));
    const snapshot = current.board;
    await act(async () => current.setMode('demo'));
    expect(current.board).toEqual(snapshot);
    expect(current.providers.length).toBeGreaterThan(0);
  });

  it('clears demo cards immediately on live-mode switch and times out stalled network calls', async () => {
    localStorage.setItem('near-next:mode', 'demo');
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')), { once: true });
    })));
    await act(async () => root.render(<Harness />));
    expect(current.board?.cards.length).toBeGreaterThan(0);
    await act(async () => current.setMode('live'));
    expect(current.mode).toBe('live');
    expect(current.board).toBeNull();
    expect(current.providers).toEqual([]);
    expect(current.loading).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(current.loading).toBe(false);
    expect(current.error).toMatch(/timed out/i);
    expect(current.board).toBeNull();
  });

  it('never substitutes demo cards for a persisted live board during a provider outage', async () => {
    localStorage.setItem('near-next:mode', 'live');
    vi.stubGlobal('fetch', vi.fn(async () => respond({ error: 'Fixture unavailable' }, 503)));
    await act(async () => root.render(<Harness />));
    expect(current.mode).toBe('live');
    expect(current.error).toMatch(/503/);
    expect(current.board).toBeNull();
    expect(current.catalog.places).toEqual([]);
  });

  it('starts a new display in live mode and shows a connection error instead of demo arrivals', async () => {
    const fetchMock = vi.fn(async () => respond({ error: 'Fixture unavailable' }, 503));
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => root.render(<Harness />));
    expect(current.mode).toBe('live');
    expect(fetchMock).toHaveBeenCalled();
    expect(current.error).toMatch(/503/);
    expect(current.board).toBeNull();
  });

  it('keeps successful snapshots stale after failure and does not refetch for presentation changes', async () => {
    localStorage.setItem('near-next:mode', 'live');
    let failBoard = false;
    const snapshot = createDemoBoard(defaultConfig);
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/capabilities')) return respond(capabilities());
      if (url.endsWith('/catalog')) return respond(demoCatalog);
      return failBoard ? respond({ error: 'Fixture unavailable' }, 503) : respond(snapshot);
    });
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => root.render(<Harness />));
    expect(current.board?.server_time).toBe(snapshot.server_time);
    const requests = fetchMock.mock.calls.length;
    await act(async () => current.setConfig(previous => ({ ...previous, label: 'Changed locally', preferences: { ...previous.preferences, theme: 'light' } })));
    expect(fetchMock).toHaveBeenCalledTimes(requests);
    failBoard = true;
    await act(async () => current.refresh());
    expect(current.error).toMatch(/503/);
    expect(current.board?.server_time).toBe(snapshot.server_time);
    expect(current.board?.cards.every(card => card.state === 'stale')).toBe(true);
    expect(current.board?.cards[0].freshness?.expires_at).toBe(snapshot.cards[0].freshness?.expires_at);
  });

  it('hides old-location telemetry immediately and ignores a superseded location response', async () => {
    const pending: ((response: Response) => void)[] = [];
    const requests: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      if (url.endsWith('/capabilities')) return respond(capabilities());
      if (url.endsWith('/catalog')) return respond(demoCatalog);
      requests.push(JSON.parse(options.body as string));
      if (requests.length === 1) return respond(createDemoBoard(defaultConfig));
      return new Promise<Response>(resolve => pending.push(resolve));
    }));
    await act(async () => root.render(<Harness />));
    expect(current.board).not.toBeNull();
    await act(async () => current.setConfig(previous => ({ ...previous, origin: { lat: 41.94, lon: -87.67 } })));
    expect(current.board).toBeNull();
    expect(current.loading).toBe(true);
    await act(async () => current.setConfig(previous => ({ ...previous, origin: { lat: 41.95, lon: -87.68 } })));
    await act(async () => pending[0](respond(createDemoBoard(defaultConfig))));
    expect(current.board).toBeNull();
    await act(async () => pending[1](respond({ ...createDemoBoard(defaultConfig), cards: [] })));
    expect(current.board?.cards).toEqual([]);
    expect(requests[2]).toMatchObject({ origin: { lat: 41.95, lon: -87.68 } });
  });
});
