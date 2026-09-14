import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';

test('a static data or legal notice update changes the offline cache without a JS change', () => {
  const directory = mkdtempSync(join(tmpdir(), 'transit-sw-'));
  const script = resolve('scripts/build-sw.mjs');
  const generate = () => {
    execFileSync(process.execPath, [script], { cwd: directory });
    return readFileSync(join(directory, 'dist/sw.js'), 'utf8').match(/const CACHE = '([^']+)'/)?.[1];
  };
  try {
    mkdirSync(join(directory, 'dist/assets'), { recursive: true });
    mkdirSync(join(directory, 'dist/data'));
    for (const [path, body] of Object.entries({ 'index.html': '<html></html>', 'favicon.svg': '<svg/>', 'data-notices.html': 'Notice v1', 'data/transit-routes.geojson': '{"imported_at":"2026-09-14"}' })) {
      writeFileSync(join(directory, 'dist', path), body);
    }
    const original = generate();
    expect(original).toBeTruthy();
    expect(generate()).toBe(original);
    writeFileSync(join(directory, 'dist/data/transit-routes.geojson'), '{"imported_at":"2026-09-15"}');
    const refreshed = generate();
    expect(refreshed).not.toBe(original);
    writeFileSync(join(directory, 'dist/data-notices.html'), 'Notice v2');
    expect(generate()).not.toBe(refreshed);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
