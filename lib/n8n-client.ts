import type { CompanyContext } from './types';

export async function callN8nWebhook(
  webhookUrl: string,
  targetUrl: string
): Promise<CompanyContext | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: targetUrl }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return {
      company_name: String(json.company_name ?? ''),
      summary: String(json.summary ?? ''),
      industry: String(json.industry ?? ''),
      services: Array.isArray(json.services) ? json.services.map(String) : [],
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
