import type { BoardCard, Freshness, TransitEvent } from './types';

export function freshnessState(value: Freshness | undefined, now: number) {
  if (!value) return 'unavailable';
  if (value.state === 'unavailable' || Date.parse(value.expires_at) <= now) return 'unavailable';
  if (value.state === 'stale' || Date.parse(value.stale_at) <= now) return 'stale';
  return 'fresh';
}

export function cardState(card: BoardCard, now: number, online: boolean) {
  if (['loading', 'unavailable', 'not_connected', 'removed'].includes(card.state) || (card.freshness && freshnessState(card.freshness, now) === 'unavailable')) return 'unavailable';
  if (!online || card.state === 'stale' || (card.freshness && freshnessState(card.freshness, now) === 'stale')) return 'stale';
  return 'fresh';
}

/** Keep independent destinations together; never let a busy direction hide another. */
export function departureGroups(events: TransitEvent[], now: number, limit = 2) {
  const groups = new Map<string, { route: string; destination: string; color?: string; events: TransitEvent[] }>();
  for (const event of [...events].sort((a, b) => eventTime(a) - eventTime(b))) {
    if (freshnessState(event.freshness, now) === 'unavailable') continue;
    if (eventTime(event) < now - 30_000 && !['delayed', 'unknown'].includes(event.status)) continue;
    const key = `${event.route}\0${event.destination}`;
    if (!groups.has(key)) groups.set(key, { route: event.route, destination: event.destination, color: event.color, events: [] });
    const group = groups.get(key)!;
    if (group.events.length < limit && !group.events.some(item => item.id === event.id)) group.events.push(event);
  }
  return [...groups.values()];
}

function eventTime(event: TransitEvent) {
  return Date.parse(event.expected_at ?? event.scheduled_at ?? '') || Infinity;
}

export function availableVehicles(card: BoardCard, now: number, online: boolean) {
  return cardState(card, now, online) === 'fresh'
    ? card.vehicles.filter(vehicle => freshnessState(vehicle.freshness, now) === 'fresh') : [];
}

export function routeColor(route: string, color?: string) {
  // Screen hex specifications in CTA's branding guide; match the server palette.
  const colors: Record<string, string> = { Brown: '#62361b', Purple: '#522398', Red: '#c60c30', Blue: '#00a1de', Green: '#009b3a', Pink: '#e27ea6', Orange: '#f9461c', Yellow: '#f9e300' };
  if (colors[route]) return colors[route];
  if (color && /^#?[a-f\d]{6}$/i.test(color)) return color.startsWith('#') ? color : `#${color}`;
  return '#377dab';
}
