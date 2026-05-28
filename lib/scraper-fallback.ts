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

export function extractCompanyFromHtml(html: string, _sourceUrl: string): CompanyContext {
  if (!html) return { company_name: '', summary: '', industry: '', services: [] };

  const $ = cheerio.load(html);

  const ogSite = $('meta[property="og:site_name"]').attr('content')?.trim();
  const titleTag = $('title').first().text().trim();
  const company_name = ogSite || titleTag || '';

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
        'User-Agent': 'BhavikScraper/1.0 (+demo)',
        Accept: 'text/html',
      },
    });
    if (!res.ok) return { company_name: '', summary: '', industry: '', services: [] };
    const reader = res.body?.getReader();
    if (!reader) {
      const text = await res.text();
      return extractCompanyFromHtml(text.slice(0, 1_000_000), url);
    }
    let received = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      chunks.push(value);
      if (received > 1_000_000) { controller.abort(); break; }
    }
    const html = new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
    return extractCompanyFromHtml(html, url);
  } catch {
    return { company_name: '', summary: '', industry: '', services: [] };
  } finally {
    clearTimeout(timer);
  }
}
