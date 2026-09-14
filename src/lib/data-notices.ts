// The catalog version preserves its import date even when Divvy adds a hash suffix.
export function stationDataDate(catalogVersion: string): string {
  return catalogVersion.match(/^chicago-(\d{4}-\d{2}-\d{2})(?:-|$)/)?.[1] ?? 'date unavailable';
}

export const metraDisclaimer = 'Not sponsored or operated by Metra.';

// Required reproduction under the City of Chicago Data Terms of Use, “USE OF DATA”.
export const chicagoDataDisclaimer = 'This site provides applications using data that has been modified for use from its original source, www.cityofchicago.org, the official website of the City of Chicago. The City of Chicago makes no claims as to the content, accuracy, timeliness, or completeness of any of the data provided at this site. The data provided at this site is subject to change at any time. It is understood that the data provided at this site is being used at one’s own risk.';
