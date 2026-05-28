import { describe, it, expect } from 'vitest';
import { validateScrapeUrl } from './url-validator';

describe('validateScrapeUrl', () => {
  it('accepts a public https URL', () => {
    const r = validateScrapeUrl('https://acme.com');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url.hostname).toBe('acme.com');
  });

  it('accepts http (some sites still are)', () => {
    expect(validateScrapeUrl('http://example.com').ok).toBe(true);
  });

  it('rejects non-http schemes', () => {
    expect(validateScrapeUrl('ftp://example.com').ok).toBe(false);
    expect(validateScrapeUrl('javascript:alert(1)').ok).toBe(false);
    expect(validateScrapeUrl('file:///etc/passwd').ok).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(validateScrapeUrl('not a url').ok).toBe(false);
    expect(validateScrapeUrl('').ok).toBe(false);
  });

  it('rejects localhost / loopback', () => {
    expect(validateScrapeUrl('http://localhost').ok).toBe(false);
    expect(validateScrapeUrl('http://127.0.0.1').ok).toBe(false);
    expect(validateScrapeUrl('http://[::1]').ok).toBe(false);
  });

  it('rejects private IPv4 ranges', () => {
    expect(validateScrapeUrl('http://10.0.0.5').ok).toBe(false);
    expect(validateScrapeUrl('http://192.168.1.1').ok).toBe(false);
    expect(validateScrapeUrl('http://172.16.0.1').ok).toBe(false);
    expect(validateScrapeUrl('http://169.254.169.254').ok).toBe(false);
  });
});
