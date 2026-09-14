import { type CSSProperties } from 'react';
import { Clock3 } from 'lucide-react';
import { formatEvent } from '../lib/format';
import { departureGroups, freshnessState, routeColor } from '../lib/presentation';
import type { TransitEvent } from '../lib/types';

export function ArrivalTime({ event, now, timeFormat }: { event: TransitEvent; now: number; timeFormat: '12h' | '24h' }) {
  const full = formatEvent(event, now, timeFormat);
  const value = full.replace(/^Scheduled\s*[·:]\s*/, '');
  const parts = /^(\d+)\s*min(?:s)?$/i.exec(value);
  return <span aria-label={full} className={`arrival-time ${event.status !== 'normal' ? 'event-exception' : ''}`}>
    {parts ? <><strong>{parts[1]}</strong><span>min</span></> : <strong className="time-word">{value}</strong>}
    {freshnessState(event.freshness, now) === 'stale' && <small>Stale</small>}
  </span>;
}

export default function Departures({ events, now, timeFormat, limit = 2 }: { events: TransitEvent[]; now: number; timeFormat: '12h' | '24h'; limit?: number }) {
  return <div className="arrival-list">{departureGroups(events, now, limit).map(group => <div className="arrival-row" key={`${group.route}:${group.destination}`}>
    <span className="route-pill" style={{ '--route-color': routeColor(group.route, group.color) } as CSSProperties}>{group.route}</span>
    <div className="arrival-destination"><strong>{group.destination}</strong>{group.events.every(event => event.time_basis === 'schedule') && <small><Clock3 size={12} aria-hidden="true" />Scheduled</small>}</div>
    <div className="departure-pair">{group.events.map(event => <ArrivalTime key={event.id} event={event} now={now} timeFormat={timeFormat} />)}</div>
  </div>)}</div>;
}
