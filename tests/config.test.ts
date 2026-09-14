import { beforeEach, describe, expect, it } from 'vitest';
import { configFromHash, displayLink, importConfig, resetConfig, serializeConfig } from '../src/lib/config';
import { config } from './fixtures';

describe('portable board configuration', () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState(null, '', '/');
  });

  it('round-trips selections, location and preferences through an export', () => {
    const original = config();
    expect(importConfig(serializeConfig(original))).toEqual(original);
  });

  it('shares an independent board in the fragment without the private display label', () => {
    const original = config();
    const url = new URL(displayLink(original));
    expect(url.pathname).toBe('/display');
    expect(url.search).toBe('');
    expect(url.hash).toMatch(/^#v1=/);
    const shared = configFromHash(url.hash);
    expect(shared).not.toBeNull();
    expect(shared?.label).not.toBe(original.label);
    expect(shared?.selections).toEqual(original.selections);
    expect(shared?.origin).toEqual(original.origin);
    expect(original.label).toBe('Private household label');
  });

  it('does not forward unknown fields or credentials into exports or links', () => {
    const injected = { ...config(), address: 'Private full street address', provider_key: 'not-a-real-provider-key' };
    const sanitized = importConfig(JSON.stringify(injected));
    const exported = serializeConfig(sanitized);
    expect(exported).not.toContain('Private full street address');
    expect(exported).not.toContain('not-a-real-provider-key');
    expect(Object.keys(sanitized)).not.toContain('provider_key');
    expect(configFromHash(new URL(displayLink(sanitized)).hash)).not.toHaveProperty('address');
  });

  it('rejects corrupt and unsupported configuration data', () => {
    for (const value of ['', '{broken', 'null', '[]', '{"version":2}', JSON.stringify({ ...config(), version: 2 })]) {
      expect(() => importConfig(value)).toThrow();
    }
    expect(() => importConfig(' '.repeat(16_385))).toThrow();
    expect(() => configFromHash('#v1=not-valid-base64-json')).toThrow();
    expect(configFromHash('')).toBeNull();
  });

  it.each([
    { lat: 40, lon: -87.63 },
    { lat: 41.89, lon: -89 },
    { lat: null, lon: -87.63 },
    { lat: '41.89', lon: -87.63 },
  ])('rejects invalid or outside Chicago origins: %j', (origin) => {
    expect(() => importConfig(JSON.stringify({ ...config(), origin }))).toThrow();
  });

  it.each([0, 6, 1.5, '3'])('rejects invalid arrival limits: %s', (limit) => {
    const original = config();
    expect(() => importConfig(JSON.stringify({ ...original, selections: [{ ...original.selections[0], limit }] }))).toThrow();
  });

  it('enforces card, vehicle-rule and radius bounds', () => {
    const original = config();
    expect(() => importConfig(JSON.stringify({ ...original, selections: Array.from({ length: 12 }, (_, i) => ({ ...original.selections[0], id: `card-${i}` })) }))).toThrow();
    expect(() => importConfig(JSON.stringify({ ...original, vehicle_rules: Array.from({ length: 4 }, (_, i) => ({ ...original.vehicle_rules[0], id: `rule-${i}` })) }))).toThrow();
    expect(() => importConfig(JSON.stringify({ ...original, vehicle_rules: [{ ...original.vehicle_rules[0], radius_m: 2_001 }] }))).toThrow();
    expect(() => importConfig(JSON.stringify({ ...original, vehicle_rules: [{ ...original.vehicle_rules[0], provider_id: 'unknown-provider' }] }))).toThrow();
  });

  it('rejects selectors the API cannot accept', () => {
    const original = config();
    for (const selection of [
      { ...original.selections[0], id: 'x'.repeat(129) },
      { ...original.selections[0], route: ' ' },
      { ...original.selections[0], destination: 'Kimball\nStation' },
      { ...original.selections[0], destination: 'x'.repeat(121) },
    ]) {
      expect(() => importConfig(JSON.stringify({ ...original, selections: [selection] }))).toThrow();
    }
  });

  it('does not mutate the defaults when a reset configuration is edited', () => {
    const first = resetConfig();
    const expected = JSON.stringify(first);
    first.label = 'Changed';
    first.origin.lat = 41.7;
    first.selections.splice(0);
    expect(JSON.stringify(resetConfig())).toBe(expected);
  });
});
