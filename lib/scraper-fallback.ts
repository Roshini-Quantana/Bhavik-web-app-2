import * as cheerio from 'cheerio';
import type { CompanyContext } from './types';

const INDUSTRY_KEYWORDS: Array<[string, string]> = [
  ['saas', 'SaaS'],
  ['e-commerce', 'E-commerce'],
  ['ecommerce', 'E-commerce'],
  ['fintech', 'FinTech'],
  ['healthcare', 'Healthcare'],
  ['health', 'Healthcare'],
  ['education', 'Education'],
  ['consulting', 'Consulting'],
  ['marketing', 'Marketing'],
  ['real estate', 'Real Estate'],
  ['logistics', 'Logistics'],
  ['manufacturing', 'Manufacturing'],
  ['ai', 'AI / ML'],
];

function cleanTitle(t: string): string {
  if (!t) return '';
  // Many corporate titles look like "Acme | Tagline" or "Acme - Buy Now".
  // Take the first segment before common separators so we get just the brand.
  const cleaned = t.split(/[|–—·•]| - |:\s/, 1)[0].trim();
  return cleaned || t.trim();
}

export function deriveCompanyFromUrl(sourceUrl: string): string {
  try {
    const host = new URL(sourceUrl).hostname.replace(/^www\./i, '');
    const root = host.split('.')[0] || '';
    if (!root) return '';
    return root.length <= 4 ? root.toUpperCase() : root.charAt(0).toUpperCase() + root.slice(1);
  } catch {
    return '';
  }
}

export function extractCompanyFromHtml(html: string, _sourceUrl: string): CompanyContext {
  if (!html) return { company_name: '', summary: '', industry: '', services: [] };

  const $ = cheerio.load(html);

  const ogSite = $('meta[property="og:site_name"]').attr('content')?.trim();
  const titleTag = $('title').first().text().trim();
  const company_name = ogSite || cleanTitle(titleTag) || '';

  const metaDesc = $('meta[name="description"]').attr('content')?.trim();
  const ogDesc = $('meta[property="og:description"]').attr('content')?.trim();
  let summary = metaDesc || ogDesc || '';
  if (!summary) {
    const firstP = $('p').first().text().trim();
    summary = firstP.slice(0, 300);
  }

  const haystack = (summary + ' ' + titleTag).toLowerCase();
  let industry = '';
  for (const [needle, label] of INDUSTRY_KEYWORDS) {
    if (haystack.includes(needle)) { industry = label; break; }
  }

  const services = $('h2').map((_, el) => $(el).text().trim()).get().slice(0, 5).filter(Boolean);

  return { company_name, summary, industry, services };
}

export async function fetchAndScrape(url: string): Promise<CompanyContext> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Many corporate sites (e.g. tcs.com) block non-browser UAs.
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) {
      return { company_name: deriveCompanyFromUrl(url), summary: '', industry: '', services: [] };
    }
    const reader = res.body?.getReader();
    let html: string;
    if (!reader) {
      html = (await res.text()).slice(0, 1_000_000);
    } else {
      let received = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        chunks.push(value);
        if (received > 1_000_000) { controller.abort(); break; }
      }
      html = new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
    }
    const ctx = extractCompanyFromHtml(html, url);
    if (!ctx.company_name) ctx.company_name = deriveCompanyFromUrl(url);
    return ctx;
  } catch {
    return { company_name: deriveCompanyFromUrl(url), summary: '', industry: '', services: [] };
  } finally {
    clearTimeout(timer);
  }
}
