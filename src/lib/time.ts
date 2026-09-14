import type { TransitEvent } from './types';

export function formatClock(now: Date | number, timeFormat: '12h' | '24h'): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', hour12: timeFormat === '12h' }).format(now);
}

export function formatEvent(event: TransitEvent, now: Date | number, timeFormat: '12h' | '24h'): string {
  const nowMs = +now;
  if (event.status === 'canceled') return 'Canceled';
  if (event.status === 'skipped') return 'Skipped';
  const expiry = Date.parse(event.freshness.expires_at);
  if (!Number.isFinite(expiry) || expiry <= nowMs || event.freshness.state === 'unavailable') return 'Unavailable';
  if (event.status === 'delayed') return 'Delayed';
  const value = event.time_basis === 'prediction' ? event.expected_at : event.scheduled_at;
  if (event.time_basis === 'unknown' || !value) return '—';
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return '—';
  const remaining = at - nowMs;
  if (remaining < 0) return 'Departed';
  if (event.time_basis === 'schedule') return `Scheduled · ${formatClock(new Date(at), timeFormat)}`;
  if (remaining <= 60000 && event.approaching) return 'Due';
  if (remaining <= 3600000) return `${Math.max(1, Math.ceil(remaining / 60000))} min`;
  return formatClock(new Date(at), timeFormat);
}
