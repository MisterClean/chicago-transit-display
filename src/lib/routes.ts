import { z } from 'zod';
const coordinate = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const routesSchema = z.object({
  type: z.literal('FeatureCollection'), imported_at: z.string(),
  features: z.array(z.object({ type: z.literal('Feature'), properties: z.object({ id: z.string(), route: z.string(), name: z.string(), kind: z.enum(['bus', 'rail', 'metra']), color: z.string().regex(/^#[\da-f]{6}$/i) }), geometry: z.object({ type: z.literal('MultiLineString'), coordinates: z.array(z.array(coordinate).min(2)) }) })).max(1000),
});
export type RouteCollection = z.infer<typeof routesSchema>;
let pending: Promise<RouteCollection> | undefined;
export function loadRoutes() {
  pending ??= fetch('/data/transit-routes.geojson').then(async response => {
    if (!response.ok) throw new Error('Route geometry unavailable');
    return routesSchema.parse(await response.json());
  }).catch(error => { pending = undefined; throw error; });
  return pending;
}
