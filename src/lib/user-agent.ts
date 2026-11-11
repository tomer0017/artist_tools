// A short, human description of a browser from its User-Agent ("Safari on
// iPhone"), for the signed-in devices list. Approximate by nature: it only
// helps people recognise their own devices.

const BROWSERS: [RegExp, string][] = [
  [/EdgA?\//, 'Edge'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/CriOS\/|Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/Mac OS X|Macintosh/, 'Mac'],
  [/Windows/, 'Windows'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

/** The browser and system names (product names, never translated), when recognised. */
export function parseUserAgent(userAgent: string | null | undefined): { browser: string | null; system: string | null } {
  if (!userAgent) return { browser: null, system: null };
  return {
    browser: BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null,
    system: SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null,
  };
}

/** In English, for the data export ("Safari on iPhone"); the account page words it in its own language. */
export function describeUserAgent(userAgent: string | null | undefined): string {
  const { browser, system } = parseUserAgent(userAgent);
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? 'Unknown device';
}

/** Enough of an IP address to recognise a network, not to locate anyone: 203.0.113.x, 2001:db8:85a3:…. */
export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return `${ip.split('.').slice(0, 3).join('.')}.x`;
  if (ip.includes(':')) return `${ip.split(':').slice(0, 3).join(':')}:…`;
  return null;
}
