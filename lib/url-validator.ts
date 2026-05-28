type Result = { ok: true; url: URL } | { ok: false; reason: string };

const PRIVATE_V4_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
];

export function validateScrapeUrl(input: string): Result {
  if (!input || typeof input !== 'string') {
    return { ok: false, reason: 'empty url' };
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: 'malformed url' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'only http/https allowed' };
  }

  const host = url.hostname.toLowerCase();

  if (host === 'localhost' || host === '0.0.0.0') {
    return { ok: false, reason: 'loopback not allowed' };
  }

  if (host === '::1' || host === '[::1]') {
    return { ok: false, reason: 'IPv6 loopback not allowed' };
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    for (const pat of PRIVATE_V4_PATTERNS) {
      if (pat.test(host)) {
        return { ok: false, reason: 'private IP range not allowed' };
      }
    }
  }

  return { ok: true, url };
}
