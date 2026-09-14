import { z } from 'zod';

export const originSchema = z.object({ lat: z.number().min(41.6).max(42.1), lon: z.number().min(-88).max(-87.45) });
const id = z.string().min(1).max(128).regex(/^[a-zA-Z0-9:_-]+$/);
const label = z.string().max(200);
const filter = z.string().trim().min(1).max(120).refine(value => new TextEncoder().encode(value).length <= 120 && !/[\u0000-\u001f\u007f-\u009f]/.test(value), 'Route and destination must fit 120 bytes and contain no control characters.');
const limit = z.number().int().min(1).max(5);
export const configSchema = z.object({
  version: z.literal(1), label: z.string().max(80), origin: originSchema,
  selections: z.array(z.object({ id, place_id: id, route: filter.optional(), destination: filter.optional(), limit })).max(12),
  vehicle_rules: z.array(z.object({ id, provider_id: z.literal('divvy'), type: z.enum(['electric', 'scooter']), radius_m: z.number().int().min(100).max(2000), limit })).max(3),
  preferences: z.object({ theme: z.enum(['dark', 'light']), time_format: z.enum(['12h', '24h']), show_map: z.boolean(), show_alerts: z.boolean(), text_scale: z.number().min(0.85).max(1.5), orientation: z.enum(['auto', 'landscape', 'portrait']) }),
}).superRefine((value, ctx) => {
  const ids = [...value.selections, ...value.vehicle_rules].map(item => item.id);
  if (ids.length > 12) ctx.addIssue({ code: 'custom', message: 'A board can contain at most 12 cards.' });
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Card IDs must be unique.' });
});

const timestamp = z.string().datetime({ offset: true });
export const freshnessSchema = z.object({ fetched_at: timestamp, source_observed_at: timestamp.optional(), stale_at: timestamp, expires_at: timestamp, state: z.enum(['fresh', 'stale', 'unavailable']) });
export const placeSchema = z.object({ id, provider_id: id, source_id: z.string().max(140), kind: z.enum(['bus_stop', 'rail_station', 'metra_station', 'shared_station']), name: label, lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), routes: z.array(label).max(100), direction: label.optional(), color: z.string().regex(/^#?[0-9a-fA-F]{6}$/).optional() });
export const providerSchema = z.object({ id, name: label, connection_state: z.enum(['enabled', 'pending', 'unavailable', 'disabled']), message: z.string().max(2000).optional(), attribution: z.string().max(2000), terms_url: z.string().url().startsWith('https://') });
export const eventSchema = z.object({ id: z.string().max(300), route: label, destination: label, expected_at: timestamp.nullable(), scheduled_at: timestamp.nullable(), time_basis: z.enum(['prediction', 'schedule', 'unknown']), status: z.enum(['normal', 'delayed', 'canceled', 'skipped', 'unknown']), approaching: z.boolean(), event_kind: z.enum(['arrival', 'departure']), color: z.string().regex(/^#?[0-9a-fA-F]{6}$/).optional(), freshness: freshnessSchema });
export const vehicleSchema = z.object({ id: z.string().max(300), lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), type: z.enum(['classic', 'electric', 'scooter']), distance_m: z.number().nonnegative(), location_label: label.optional(), freshness: freshnessSchema });
const count = z.number().int().nonnegative().nullable();
export const cardSchema = z.object({ id, kind: z.enum(['bus_stop', 'rail_station', 'metra_station', 'shared_station', 'vehicles']), title: label, subtitle: label, provider_id: id, state: z.enum(['ready', 'loading', 'empty', 'unavailable', 'stale', 'not_connected', 'removed']), message: z.string().max(2000).optional(), place: placeSchema.optional(), events: z.array(eventSchema).max(100), availability: z.object({ classic: count, electric: count, scooters: count, docks: count, rental_state: z.enum(['available', 'unavailable', 'unknown']) }).optional(), vehicles: z.array(vehicleSchema).max(20), freshness: freshnessSchema.optional(), alerts: z.array(z.string().max(5000)).max(50) });
export const boardSchema = z.object({ schema_version: z.literal(1), server_time: timestamp, next_poll_after_s: z.number().min(1).max(3600), catalog_version: label, cards: z.array(cardSchema).max(12), providers: z.array(providerSchema).max(20), attributions: z.array(z.string().max(2000)).max(30) });
export const catalogSchema = z.object({ version: label, places: z.array(placeSchema).max(30000), coverage_note: z.string().max(3000) });
export const capabilitiesSchema = z.object({ schema_version: z.literal(1), catalog_version: label, providers: z.array(providerSchema).max(20), geocoding: z.boolean(), limits: z.object({ max_cards: z.number().int(), max_radius_m: z.number().int() }) });
