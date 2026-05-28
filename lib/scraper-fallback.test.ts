import { describe, it, expect } from 'vitest';
import { extractCompanyFromHtml } from './scraper-fallback';

describe('extractCompanyFromHtml', () => {
  it('pulls company name from <title>', () => {
    const html = `<html><head><title>Acme Widgets</title></head><body></body></html>`;
    const r = extractCompanyFromHtml(html, 'https://acme.com');
    expect(r.company_name).toBe('Acme Widgets');
  });

  it('prefers og:site_name over <title>', () => {
    const html = `<html><head>
      <title>Some Page Title - Buy Now</title>
      <meta property="og:site_name" content="Acme" />
    </head></html>`;
    expect(extractCompanyFromHtml(html, 'https://x.com').company_name).toBe('Acme');
  });

  it('uses meta description as summary', () => {
    const html = `<html><head>
      <meta name="description" content="We sell widgets." />
    </head></html>`;
    expect(extractCompanyFromHtml(html, 'https://x.com').summary).toContain('widgets');
  });

  it('falls back to first paragraph if no meta description', () => {
    const html = `<html><body><p>We make industrial machines for factories.</p></body></html>`;
    expect(extractCompanyFromHtml(html, 'https://x.com').summary).toContain('industrial machines');
  });

  it('detects SaaS industry keyword', () => {
    const html = `<html><head><meta name="description" content="Our SaaS platform helps teams."/></head></html>`;
    expect(extractCompanyFromHtml(html, 'https://x.com').industry.toLowerCase()).toContain('saas');
  });

  it('returns empty fields gracefully on empty html', () => {
    const r = extractCompanyFromHtml('', 'https://x.com');
    expect(r.company_name).toBe('');
    expect(r.summary).toBe('');
  });
});
