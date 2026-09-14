import { configSchema } from './schema';
import { defaultConfig } from './demo';
import type { BoardConfig, DataMode } from './types';

export const MAX_CONFIG_BYTES = 16384;
export const STORAGE_KEY = 'near-next:board:v1';

export function resetConfig(): BoardConfig { return structuredClone(defaultConfig); }
export function importConfig(text: string): BoardConfig {
  if (new TextEncoder().encode(text).length > MAX_CONFIG_BYTES) throw new Error('Settings must be smaller than 16 KiB.');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('This is not a valid settings JSON file.'); }
  const result = configSchema.safeParse(parsed);
  if (!result.success) throw new Error(`Invalid or unsupported board settings: ${result.error.issues[0]?.message ?? 'check the file'}`);
  return result.data;
}
export function serializeConfig(config: BoardConfig): string { return JSON.stringify(configSchema.parse(config), null, 2); }
export function exportConfig(config: BoardConfig): void {
  const url = URL.createObjectURL(new Blob([serializeConfig(config)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'chicago-transit-settings.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function displayLink(config: BoardConfig, mode: DataMode = 'live'): string {
  const safe = configSchema.parse({ ...config, label: 'My neighborhood' });
  const bytes = new TextEncoder().encode(JSON.stringify(safe));
  if (bytes.length > MAX_CONFIG_BYTES) throw new Error('This board is too large to share as a link. Export settings instead.');
  const encoded = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const url = new URL('/display', window.location.origin); url.hash = `v1=${encoded}&mode=${mode}`;
  return url.href;
}
export function configFromHash(hash: string): BoardConfig | null {
  if (!hash || hash === '#') return null;
  if (!hash.startsWith('#v1=')) throw new Error('Unsupported display link version.');
  const parts = hash.slice(4).split('&');
  if (parts.length > 2 || (parts.length === 2 && !/^mode=(demo|live)$/.test(parts[1]))) throw new Error('Invalid display link.');
  const raw = parts[0];
  if (raw.length > Math.ceil(MAX_CONFIG_BYTES * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error('Invalid display link.');
  try {
    const binary = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
    return importConfig(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, c => c.charCodeAt(0))));
  } catch { throw new Error('Invalid display link settings. Import a saved settings file to recover.'); }
}
export function loadConfig(): { config: BoardConfig; warning?: string } {
  try {
    const fromHash = configFromHash(window.location.hash);
    if (fromHash) return { config: fromHash };
    const saved = localStorage.getItem(STORAGE_KEY);
    return { config: saved ? importConfig(saved) : resetConfig() };
  } catch (error) {
    return { config: resetConfig(), warning: error instanceof Error ? error.message : 'Browser storage is unavailable. Export settings to keep a copy.' };
  }
}
